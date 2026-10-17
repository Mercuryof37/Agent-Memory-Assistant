import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config/config.ts';
import type { MemoryId, ProposalInput, RecordInput } from '../model/types.ts';
import { isMemoryId, newMemoryId } from '../model/ids.ts';
import { assertClean, redactPrivate } from '../scan/scan.ts';
import type { MemoryStore } from '../store/store.ts';
import { writeFileAtomic } from '../fs/atomic.ts';

/**
 * Proposal ledger (plan v1.3 §4.6, S4). A proposal is a file under
 * `proposals/pending/`; decisions live in the journal (`op: decide`), so the
 * ledger and history never disagree.
 *
 * Accepting verifies every `base_hash` before touching the store; a failed
 * accept leaves the proposal file in place (S4.4).
 */

export interface Proposal {
  readonly id: string;
  readonly op: 'supersede' | 'delete';
  readonly targets: readonly MemoryId[];
  readonly base_hashes: readonly string[];
  readonly replacements: readonly RecordInput[];
  readonly reason: string;
  readonly created_at: string;
}

export class ProposalError extends Error {
  readonly code: 'INVALID' | 'NOT_FOUND' | 'CONFLICT';
  constructor(code: ProposalError['code'], message: string) {
    super(message);
    this.name = 'ProposalError';
    this.code = code;
  }
}

export interface ProposalDeps {
  readonly store: MemoryStore;
  readonly config: Config;
}

function pendingDir(store: MemoryStore): string {
  return store.paths.pendingDir;
}

function proposalPath(store: MemoryStore, id: string): string {
  return join(pendingDir(store), `${id}.json`);
}

export function listProposals(store: MemoryStore): Proposal[] {
  let names: string[];
  try {
    names = readdirSync(pendingDir(store)).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const proposals: Proposal[] = [];
  for (const name of names) {
    try {
      proposals.push(JSON.parse(readFileSync(join(pendingDir(store), name), 'utf8')) as Proposal);
    } catch {
      // A corrupt proposal file is not a reason to hide the others.
    }
  }
  return proposals.sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export function readProposal(store: MemoryStore, id: string): Proposal {
  const file = proposalPath(store, id);
  if (!existsSync(file)) throw new ProposalError('NOT_FOUND', `no pending proposal ${id}`);
  return JSON.parse(readFileSync(file, 'utf8')) as Proposal;
}

function currentHash(store: MemoryStore, id: MemoryId): string {
  const doc = store.read(id);
  return doc.content_hash;
}

export function createProposal(deps: ProposalDeps, input: ProposalInput): Proposal {
  const { store, config } = deps;
  if (input.op === 'supersede') {
    if (input.replacements.length === 0) throw new ProposalError('INVALID', 'supersede needs replacements');
    if (input.targets.length === 0) throw new ProposalError('INVALID', 'supersede needs targets');
    const unique = new Set(input.targets);
    if (unique.size !== input.targets.length) throw new ProposalError('INVALID', 'targets must be unique');
    if (input.base_hashes.length !== input.targets.length) {
      throw new ProposalError('INVALID', 'one base_hash per target is required');
    }
    input.targets.forEach((target, index) => {
      if (!isMemoryId(target)) throw new ProposalError('INVALID', `invalid target id: ${target}`);
      const actual = currentHash(store, target);
      if (actual !== input.base_hashes[index]) {
        throw new ProposalError('CONFLICT', `base_hash for ${target} does not match the current content`);
      }
    });
    for (const replacement of input.replacements) {
      assertClean({ abstract: replacement.abstract, body: replacement.body, error_signatures: replacement.error_signatures });
    }
  } else {
    if (!isMemoryId(input.target)) throw new ProposalError('INVALID', `invalid target id: ${input.target}`);
    if (input.reason.trim() === '') throw new ProposalError('INVALID', 'a delete proposal needs a reason');
    if (currentHash(store, input.target) !== input.base_hash) {
      throw new ProposalError('CONFLICT', `base_hash for ${input.target} does not match the current content`);
    }
    assertClean({ targets: [input.target] });
  }

  const existing = listProposals(store);
  if (existing.length >= config.proposals.max_pending) {
    throw new ProposalError('CONFLICT', `pending proposals are at proposals.max_pending (${config.proposals.max_pending})`);
  }

  const proposal: Proposal = {
    id: `prop-${newMemoryId(new Date())}`,
    op: input.op,
    targets: input.op === 'supersede' ? input.targets : [input.target],
    base_hashes: input.op === 'supersede' ? input.base_hashes : [input.base_hash],
    replacements:
      input.op === 'supersede'
        ? input.replacements.map((replacement) => ({
            ...replacement,
            abstract: redactPrivate(replacement.abstract),
            body: redactPrivate(replacement.body),
          }))
        : [],
    reason: input.op === 'supersede' ? (input.reason ?? '') : input.reason,
    created_at: new Date().toISOString(),
  };
  writeFileAtomic(proposalPath(store, proposal.id), `${JSON.stringify(proposal, null, 2)}\n`);
  store.appendJournal('audit', { event: 'proposal-created', proposal: proposal.id, op: proposal.op });
  return proposal;
}

export interface DecideInput {
  readonly id: string;
  readonly decision: 'accept' | 'reject';
  readonly reason?: string;
}

/** Apply (or reject) one proposal; the pending file is removed only on success. */
export function decideProposal(deps: ProposalDeps, input: DecideInput): void {
  const { store } = deps;
  const proposal = readProposal(store, input.id);

  if (input.decision === 'reject') {
    store.appendJournal('decide', { proposal: proposal.id, decision: 'reject', reason: input.reason ?? '' });
    rmSync(proposalPath(store, proposal.id), { force: true });
    return;
  }

  if (proposal.op === 'delete') {
    const target = proposal.targets[0] as MemoryId;
    const hash = proposal.base_hashes[0] as string;
    if (currentHash(store, target) !== hash) {
      throw new ProposalError('CONFLICT', `target ${target} changed since the proposal was created`);
    }
    store.remove(target, { reason: proposal.reason, baseHash: hash });
    store.journal.append({ op: 'decide', data: { proposal: proposal.id, decision: 'accept' } });
    rmSync(proposalPath(store, proposal.id), { force: true });
    return;
  }

  proposal.targets.forEach((target, index) => {
    if (currentHash(store, target) !== proposal.base_hashes[index]) {
      throw new ProposalError('CONFLICT', `target ${target} changed since the proposal was created`);
    }
  });
  store.addMany(
    proposal.replacements.map((replacement) => ({ ...replacement, supersedes: proposal.targets })),
    { author: 'human', opId: `decide-${proposal.id}` },
  );
  store.appendJournal('decide', { proposal: proposal.id, decision: 'accept' });
  rmSync(proposalPath(store, proposal.id), { force: true });
}
