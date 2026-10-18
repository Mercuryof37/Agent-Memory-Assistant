import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config/config.ts';
import { ensureDir, writeFileAtomic } from '../fs/atomic.ts';
import { acquireLock } from '../fs/lock.ts';
import { Journal } from '../journal/journal.ts';
import { hashContent, parseMemoryFile, serializeMemory } from '../model/frontmatter.ts';
import { isMemoryId, newMemoryId } from '../model/ids.ts';
import { activeDocs, today } from '../model/validity.ts';
import { supersedeProblems } from '../model/validity.ts';
import { buildIndex, search } from '../index/bm25.ts';
import { TOKENIZER_VERSION } from '../index/tokenizer.ts';
import { scanInput } from '../scan/scan.ts';
import type {
  Kind,
  MemoryDoc,
  MemoryId,
  RecallResult,
  RecallHit,
  RebuildReport,
  RecordInput,
  ProvenanceEntry,
  Stats,
  WriteResult,
} from '../model/types.ts';
import { memoryPaths, type MemoryPaths } from '../paths.ts';

export interface StoreOptions {
  readonly home: string;
  readonly config: Config;
  readonly now?: () => Date;
  /** Test seam: called before each commit step; production passes undefined. */
  readonly beforeStep?: (step: string) => void;
}

export class MemoryStoreError extends Error {
  readonly code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT';
  constructor(code: MemoryStoreError['code'], message: string) {
    super(message);
    this.name = 'MemoryStoreError';
    this.code = code;
  }
}

const KINDS: readonly Kind[] = ['fact', 'pitfall', 'exp'];
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDate(value: string): boolean {
  const match = DATE.exec(value);
  if (match === null) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

export class MemoryStore {
  readonly paths: MemoryPaths;
  readonly config: Config;
  readonly journal: Journal;
  private readonly now: () => Date;
  private readonly beforeStep: ((step: string) => void) | undefined;
  private docs = new Map<MemoryId, MemoryDoc>();
  private quarantined = new Map<MemoryId, string>();
  private deleted = new Set<MemoryId>();
  private accounted = new Map<MemoryId, string>();
  private issues: string[] = [];
  private head: { seq: number; hash: string } | null = null;

  constructor(options: StoreOptions) {
    this.paths = memoryPaths(options.home);
    this.config = options.config;
    this.now = options.now ?? (() => new Date());
    this.beforeStep = options.beforeStep;
    this.journal = new Journal(this.paths.journalDir);
    this.reload();
  }

  /** Re-read the journal and the memory files; classify each file. */
  reload(): void {
    const read = this.journal.readAll();
    this.issues = read.issues.map((issue) => issue.message);
    this.head = read.head;
    this.docs = new Map();
    this.quarantined = new Map();
    this.deleted = new Set();
    this.accounted = new Map();

    const latest = new Map<MemoryId, { hash: string; deleted: boolean }>();
    for (const entry of read.entries) {
      const id = typeof entry.data.id === 'string' ? entry.data.id : undefined;
      if (entry.op === 'record' || entry.op === 'adopt') {
        if (id === undefined || typeof entry.data.sha256 !== 'string') continue;
        latest.set(id, { hash: entry.data.sha256, deleted: latest.get(id)?.deleted ?? false });
      } else if (entry.op === 'delete') {
        if (id === undefined) continue;
        latest.set(id, { hash: latest.get(id)?.hash ?? '', deleted: true });
        this.deleted.add(id);
      }
    }
    for (const [id, value] of latest) {
      if (value.hash !== '') this.accounted.set(id, value.hash);
    }

    for (const kind of KINDS) {
      const dir = join(this.paths.memoriesDir, kind);
      let names: string[];
      try {
        names = readdirSync(dir).filter((name) => name.endsWith('.md'));
      } catch {
        continue;
      }
      for (const name of names) {
        const file = join(dir, name);
        const id = name.slice(0, -3);
        try {
          const text = readFileSync(file, 'utf8');
          const doc = parseMemoryFile(text, file, {
            abstractChars: this.config.limits.abstract_chars,
            bodyChars: this.config.limits.body_chars,
            maxRecordChars: this.config.storage.max_record_chars,
          });
          if (!isMemoryId(id) || doc.id !== id) {
            this.quarantined.set(doc.id || id, 'id does not match filename');
            continue;
          }
          if (doc.kind !== kind) {
            this.quarantined.set(doc.id, 'kind does not match directory');
            continue;
          }
          const accountedHash = this.accounted.get(doc.id);
          if (accountedHash === undefined) {
            this.quarantined.set(doc.id, 'not accounted in journal');
            continue;
          }
          if (accountedHash !== doc.content_hash) {
            this.quarantined.set(doc.id, 'content hash differs from journal');
            continue;
          }
          this.docs.set(doc.id, doc);
        } catch (error) {
          this.quarantined.set(id, `parse: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // A journal record whose file is gone is not usable either — unless the
    // journal also records a delete/purge for it (a tombstone is not corruption).
    for (const id of this.accounted.keys()) {
      if (this.deleted.has(id)) continue;
      if (!this.docs.has(id) && !this.quarantined.has(id)) {
        this.quarantined.set(id, 'accounted in journal but file is missing');
      }
    }

    // Tripwire: the manifest records where the journal ended after the last
    // successful rebuild. A *shorter* journal now means truncation, not progress.
    // A *longer* journal means a writer appended without refreshing the
    // manifest (the chain is intact), which is a stale derived file, not
    // truncation — the next `writeDerived` catches up.
    try {
      const manifest = JSON.parse(readFileSync(this.paths.manifestFile, 'utf8')) as {
        journal_head?: { seq?: number; hash?: string } | null;
      };
      const expected = manifest.journal_head;
      const expectedSeq = expected?.seq;
      const expectedHash = expected?.hash;
      if (expectedSeq === undefined || expectedHash === undefined) {
        // No complete head recorded yet; nothing to compare.
      } else if (this.head === null) {
        this.issues.push('journal is empty but the manifest records a head: possible truncation');
      } else if (expectedSeq !== this.head.seq) {
        if (expectedSeq > this.head.seq) {
          this.issues.push(
            `journal head #${this.head.seq} is behind the manifest (#${String(expectedSeq)}): possible truncation`,
          );
        }
        // expectedSeq < this.head.seq: stale manifest, self-heals on write.
      } else if (expectedHash !== this.head.hash) {
        this.issues.push(
          `journal head #${this.head.seq} differs from the manifest (#${String(expectedSeq)}): possible truncation`,
        );
      }
    } catch {
      // A missing or unreadable manifest is a cache problem, not a journal one.
    }
  }

  active(date: string = today(this.now())): readonly MemoryDoc[] {
    const live = activeDocs(this.docs.values(), date);
    return live.filter((doc) => !this.deleted.has(doc.id) && !this.quarantined.has(doc.id));
  }

  read(id: MemoryId): MemoryDoc {
    // The host keeps one store open for the app process; `mem decide` / `mem add`
    // write disk underneath it. Re-scan before a single-document read so a
    // record created by the CLI is immediately readable through `memory_read`.
    this.reload();
    const doc = this.docs.get(id);
    if (doc === undefined) {
      const reason = this.quarantined.get(id);
      throw new MemoryStoreError(
        'NOT_FOUND',
        reason === undefined ? `no memory with id ${id}` : `memory ${id} is quarantined: ${reason}`,
      );
    }
    return doc;
  }

  recall(
    query: string,
    options: { limit?: number; asOf?: string; kinds?: readonly Kind[] } = {},
  ): RecallResult {
    const text = query.trim();
    if (text === '') return { hits: [], warnings: ['empty query'] };
    // The host keeps one store open for the whole app process; `mem decide` and
    // other CLI writes change disk underneath it. Re-scan so recall reflects
    // them immediately (plan v1.3 §6.1: recall stays live while the catalog is
    // frozen).
    this.reload();
    const date = options.asOf ?? today(this.now());
    const limit = Math.min(
      options.limit ?? this.config.recall.limit,
      this.config.recall.max_limit,
    );
    const activeSet = activeDocs(this.docs.values(), date).filter(
      (doc) => !this.deleted.has(doc.id) && !this.quarantined.has(doc.id),
    );
    const index = buildIndex(activeSet, TOKENIZER_VERSION);
    const found = search(index, text, {
      limit,
      minScorePermille: this.config.recall.min_score,
      ...(options.kinds === undefined ? {} : { kinds: options.kinds }),
    });
    const byId = new Map(activeSet.map((doc) => [doc.id, doc]));
    const hits: RecallHit[] = [];
    for (const hit of found) {
      const doc = byId.get(hit.id);
      if (doc === undefined) continue;
      hits.push({
        id: doc.id,
        kind: doc.kind,
        abstract: doc.abstract,
        score: hit.score,
        valid_from: doc.valid_from,
        valid_until: doc.valid_until,
        provenance_verifiable: doc.provenance.length > 0,
      });
    }
    return {
      hits,
      warnings: this.quarantined.size === 0 ? [] : [...this.quarantined.values()].slice(0, 5),
    };
  }

  stats(): Stats {
    return {
      active: this.active().length,
      total_files: this.docs.size + this.quarantined.size,
      quarantined: this.quarantined.size,
      deleted: this.deleted.size,
      pending_proposals: countPending(this.paths.pendingDir),
      journal_head: this.head,
      journal_consistent: this.issues.length === 0,
    };
  }

  /**
   * Write one new memory. The caller supplies an author; provenance/evidence
   * binding arrives with the DSH adapter in S4. Duplicate content returns the
   * existing id without touching its file (plan v1.3 §5.4).
   */
  add(
    input: RecordInput,
    options: { author: 'agent' | 'human'; opId?: string; provenance?: readonly ProvenanceEntry[] },
  ): WriteResult {
    this.validateInput(input);
    const lock = acquireLock({
      file: this.paths.lockFile,
      config: {
        heartbeatMs: this.config.lock.heartbeat_ms,
        staleMs: this.config.lock.stale_ms,
        timeoutMs: this.config.lock.timeout_ms,
      },
      now: () => this.now().getTime(),
    });
    try {
      this.reload();
      if (this.issues.length > 0) {
        throw new MemoryStoreError(
          'CONFLICT',
          `journal is inconsistent, writes are blocked: ${this.issues[0]}`,
        );
      }
      const duplicate = this.findDuplicate(input, options.author);
      if (duplicate !== undefined) {
        this.beforeStep?.('before-journal');
        this.journal.append({
          op: 'audit',
          opId: options.opId === undefined ? undefined : `${options.opId}-dedupe`,
          data: { event: 'dedupe', id: duplicate.id },
        });
        return { id: duplicate.id, content_hash: duplicate.content_hash, deduplicated: true, warnings: [] };
      }

      const now = this.now();
      const validFrom = input.valid_from ?? today(now);
      if (!isRealDate(validFrom)) {
        throw new MemoryStoreError('INVALID', `valid_from must be a real YYYY-MM-DD date, found ${validFrom}`);
      }
      const duplicateId = this.allocateId(now);
      const doc = {
        id: duplicateId,
        mem_schema: 1 as const,
        kind: input.kind,
        scope: 'local' as const,
        abstract: input.abstract,
        created_at: now.toISOString(),
        valid_from: validFrom,
        valid_until: null,
        supersedes: [] as readonly MemoryId[],
        author: options.author,
        evidence_level: input.evidence_level,
        error_signatures: input.error_signatures ?? [],
        provenance: options.provenance ?? [],
        body: input.body,
      };
      const text = serializeMemory(doc);
      const filePath = join(this.paths.memoriesDir, doc.kind, `${doc.id}.md`);

      this.beforeStep?.('before-write');
      ensureDir(join(this.paths.memoriesDir, doc.kind));
      writeFileAtomic(filePath, text);

      this.beforeStep?.('before-journal');
      const hash = hashContent(text);
      this.journal.append({
        op: 'record',
        ...(options.opId === undefined ? {} : { opId: options.opId }),
        data: { id: doc.id, sha256: hash },
      });

      this.beforeStep?.('before-derived');
      this.reload();
      this.writeDerived();
      // The manifest now records the new head; re-scan so `stats()` and later
      // reads do not keep the transient head-vs-manifest mismatch.
      this.reload();
      return { id: doc.id, content_hash: hash, deduplicated: false, warnings: [] };
    } finally {
      lock.release();
    }
  }

  /**
   * Accept a hand-placed or hand-edited file after a human reviewed it: append
   * an `adopt` journal line with the file's current hash. The file itself is
   * never rewritten.
   */
  adopt(id: MemoryId): WriteResult {
    if (!isMemoryId(id)) {
      throw new MemoryStoreError('INVALID', `"${id}" is not a memory id`);
    }
    const lock = acquireLock({
      file: this.paths.lockFile,
      config: {
        heartbeatMs: this.config.lock.heartbeat_ms,
        staleMs: this.config.lock.stale_ms,
        timeoutMs: this.config.lock.timeout_ms,
      },
      now: () => this.now().getTime(),
    });
    try {
      this.reload();
      if (this.issues.length > 0) {
        throw new MemoryStoreError('CONFLICT', `journal is inconsistent: ${this.issues[0]}`);
      }
      if (this.deleted.has(id)) {
        throw new MemoryStoreError('CONFLICT', `memory ${id} was deleted and cannot be adopted`);
      }
      const file = this.findMemoryFile(id);
      if (file === undefined) {
        throw new MemoryStoreError('NOT_FOUND', `no memory file for ${id}`);
      }
      const text = readFileSync(file, 'utf8');
      let doc: MemoryDoc;
      try {
        doc = parseMemoryFile(text, file, {
          abstractChars: this.config.limits.abstract_chars,
          bodyChars: this.config.limits.body_chars,
          maxRecordChars: this.config.storage.max_record_chars,
        });
      } catch (error) {
        throw new MemoryStoreError(
          'INVALID',
          `cannot adopt ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (doc.id !== id) {
        throw new MemoryStoreError('INVALID', `file ${file} declares id ${doc.id}, not ${id}`);
      }
      const findings = scanInput({
        abstract: doc.abstract,
        body: doc.body,
        error_signatures: doc.error_signatures,
      });
      if (findings.length > 0) {
        throw new MemoryStoreError(
          'INVALID',
          `adopt rejected by scan: ${findings.map((finding) => `${finding.rule}@${finding.field}`).join(', ')}`,
        );
      }
      this.journal.append({
        op: 'adopt',
        opId: `adopt-${id}-${doc.content_hash.slice(0, 16)}`,
        data: { id, sha256: doc.content_hash },
      });
      this.reload();
      this.writeDerived();
      this.reload();
      return { id, content_hash: doc.content_hash, deduplicated: false, warnings: [] };
    } finally {
      lock.release();
    }
  }

  /**
   * End a memory's validity without touching its file: one `delete` line in the
   * journal removes it from recall and the catalog, while `read` still works.
   */
  remove(id: MemoryId, options: { reason: string; baseHash?: string }): WriteResult {
    if (!isMemoryId(id)) {
      throw new MemoryStoreError('INVALID', `"${id}" is not a memory id`);
    }
    if (options.reason.trim() === '') {
      throw new MemoryStoreError('INVALID', 'a delete needs a reason');
    }
    const lock = acquireLock({
      file: this.paths.lockFile,
      config: {
        heartbeatMs: this.config.lock.heartbeat_ms,
        staleMs: this.config.lock.stale_ms,
        timeoutMs: this.config.lock.timeout_ms,
      },
      now: () => this.now().getTime(),
    });
    try {
      this.reload();
      if (this.issues.length > 0) {
        throw new MemoryStoreError('CONFLICT', `journal is inconsistent: ${this.issues[0]}`);
      }
      if (this.deleted.has(id)) {
        throw new MemoryStoreError('CONFLICT', `memory ${id} is already deleted`);
      }
      const doc = this.docs.get(id);
      if (doc === undefined) {
        const reason = this.quarantined.get(id);
        throw new MemoryStoreError(
          'NOT_FOUND',
          reason === undefined ? `no memory with id ${id}` : `memory ${id} is quarantined: ${reason}`,
        );
      }
      if (options.baseHash !== undefined && options.baseHash !== doc.content_hash) {
        throw new MemoryStoreError('CONFLICT', `memory ${id} changed since base_hash was taken`);
      }
      this.journal.append({
        op: 'delete',
        data: { id, sha256: doc.content_hash, reason: options.reason },
      });
      this.reload();
      this.writeDerived();
      this.reload();
      return { id, content_hash: doc.content_hash, deduplicated: false, warnings: [] };
    } finally {
      lock.release();
    }
  }

  /**
   * Write several memories under one lock. Files are written first; if any write
   * fails, the already-written files are removed before rethrowing, so a failed
   * supersede leaves no half-applied replacement (S4.4).
   */
  addMany(
    inputs: readonly (RecordInput & {
      readonly supersedes?: readonly MemoryId[];
      readonly provenance?: readonly ProvenanceEntry[];
    })[],
    options: { author: 'agent' | 'human'; opId?: string },
  ): WriteResult[] {
    if (inputs.length === 0) return [];
    for (const input of inputs) this.validateInput(input);
    const lock = acquireLock({
      file: this.paths.lockFile,
      config: {
        heartbeatMs: this.config.lock.heartbeat_ms,
        staleMs: this.config.lock.stale_ms,
        timeoutMs: this.config.lock.timeout_ms,
      },
      now: () => this.now().getTime(),
    });
    try {
      this.reload();
      if (this.issues.length > 0) {
        throw new MemoryStoreError('CONFLICT', `journal is inconsistent, writes are blocked: ${this.issues[0]}`);
      }
      const now = this.now();
      const prepared = inputs.map((input) => {
        const id = newMemoryId(now);
        const supersedes = input.supersedes ?? [];
        const problems = supersedeProblems(
          { id, supersedes, valid_from: input.valid_from ?? today(now) },
          this.docs,
        );
        if (problems.length > 0) throw new MemoryStoreError('INVALID', problems.join('; '));
        const doc = {
          id,
          mem_schema: 1 as const,
          kind: input.kind,
          scope: 'local' as const,
          abstract: input.abstract,
          created_at: now.toISOString(),
          valid_from: input.valid_from ?? today(now),
          valid_until: null,
          supersedes,
          author: options.author,
          evidence_level: input.evidence_level,
          error_signatures: input.error_signatures ?? [],
          provenance: input.provenance ?? [],
          body: input.body,
        };
        return { id, text: serializeMemory(doc), hash: '', kind: doc.kind };
      });

      this.beforeStep?.('before-write');
      const written: string[] = [];
      try {
        for (const entry of prepared) {
          const file = join(this.paths.memoriesDir, entry.kind, `${entry.id}.md`);
          ensureDir(join(this.paths.memoriesDir, entry.kind));
          writeFileAtomic(file, entry.text);
          written.push(file);
        }
      } catch (error) {
        for (const file of written) rmSync(file, { force: true });
        throw error;
      }

      this.beforeStep?.('before-journal');
      for (const entry of prepared) {
        const hash = hashContent(entry.text);
        this.journal.append({
          op: 'record',
          ...(options.opId === undefined ? {} : { opId: `${options.opId}-${entry.id}` }),
          data: { id: entry.id, sha256: hash },
        });
        (entry as { hash: string }).hash = hash;
      }

      this.beforeStep?.('before-derived');
      this.reload();
      this.writeDerived();
      this.reload();
      return prepared.map((entry) => ({
        id: entry.id,
        content_hash: entry.hash,
        deduplicated: false,
        warnings: [],
      }));
    } finally {
      lock.release();
    }
  }

  /**
   * Append an audit/decide line and refresh the manifest in the same lock, so a
   * journal write made outside `add`/`remove` never looks like truncation.
   */
  appendJournal(op: 'audit' | 'decide', data: Readonly<Record<string, unknown>>): void {
    const lock = acquireLock({
      file: this.paths.lockFile,
      config: {
        heartbeatMs: this.config.lock.heartbeat_ms,
        staleMs: this.config.lock.stale_ms,
        timeoutMs: this.config.lock.timeout_ms,
      },
      now: () => this.now().getTime(),
    });
    try {
      this.reload();
      this.journal.append({ op, data });
      this.reload();
      this.writeDerived();
      this.reload();
    } finally {
      lock.release();
    }
  }

  /** Audit append for non-store writers (snapshot capture): refreshes the manifest head too. */
  appendAudit(data: Readonly<Record<string, unknown>>): void {
    this.appendJournal('audit', data);
  }

  /** Physically remove one memory (human T2): tombstone in journal, file gone. */
  purge(id: MemoryId, options: { reason: string }): { removed: boolean; proposals: number } {
    if (!isMemoryId(id)) throw new MemoryStoreError('INVALID', `"${id}" is not a memory id`);
    const lock = acquireLock({
      file: this.paths.lockFile,
      config: {
        heartbeatMs: this.config.lock.heartbeat_ms,
        staleMs: this.config.lock.stale_ms,
        timeoutMs: this.config.lock.timeout_ms,
      },
      now: () => this.now().getTime(),
    });
    try {
      this.reload();
      const file = this.findMemoryFile(id);
      if (file === undefined) throw new MemoryStoreError('NOT_FOUND', `no memory file for ${id}`);
      const doc = this.docs.get(id);
      this.journal.append({
        op: 'delete',
        data: { id, purged: true, reason: options.reason, sha256: doc?.content_hash ?? '' },
      });
      rmSync(file, { force: true });

      let proposals = 0;
      let names: string[] = [];
      try {
        names = readdirSync(this.paths.pendingDir).filter((name) => name.endsWith('.json'));
      } catch {
        names = [];
      }
      for (const name of names) {
        const path = join(this.paths.pendingDir, name);
        try {
          const proposal = JSON.parse(readFileSync(path, 'utf8')) as { id?: string; targets?: unknown };
          if (Array.isArray(proposal.targets) && proposal.targets.includes(id)) {
            rmSync(path, { force: true });
            this.journal.append({
              op: 'audit',
              data: { event: 'proposal-invalidated', proposal: proposal.id ?? name, target: id },
            });
            proposals += 1;
          }
        } catch {
          // A corrupt pending file is left for `doctor`, not silently deleted.
        }
      }

      this.reload();
      this.writeDerived();
      this.reload();
      return { removed: true, proposals };
    } finally {
      lock.release();
    }
  }

  rebuild(): RebuildReport {
    const lock = acquireLock({
      file: this.paths.lockFile,
      config: {
        heartbeatMs: this.config.lock.heartbeat_ms,
        staleMs: this.config.lock.stale_ms,
        timeoutMs: this.config.lock.timeout_ms,
      },
      now: () => this.now().getTime(),
    });
    try {
      this.reload();
      if (this.issues.length > 0) {
        // Rebuilding derived files must not rewrite `journal_head` over a
        // truncated or broken chain: that would hide the damage the manifest
        // tripwire exists to expose.
        throw new MemoryStoreError(
          'CONFLICT',
          `journal is inconsistent, repair it before rebuild: ${this.issues[0]}`,
        );
      }
      this.writeDerived();
      return {
        records: this.accounted.size,
        files: this.docs.size,
        quarantined: [...this.quarantined.keys()],
        journal_head: this.head,
        journal_consistent: true,
        rebuilt_index: true,
        rebuilt_catalog: true,
      };
    } finally {
      lock.release();
    }
  }

  /** Quarantine and journal diagnostics, used by `mem doctor`. */
  diagnostics(): { quarantined: ReadonlyMap<MemoryId, string>; issues: readonly string[]; head: { seq: number; hash: string } | null } {
    return { quarantined: this.quarantined, issues: this.issues, head: this.head };
  }

  private writeDerived(): void {
    const active = this.active();
    const manifest = {
      schema: 1,
      tokenizer_version: TOKENIZER_VERSION,
      built_at: this.now().toISOString(),
      journal_head: this.head,
      entries: active.map((doc) => ({
        id: doc.id,
        kind: doc.kind,
        abstract: doc.abstract,
        valid_from: doc.valid_from,
        valid_until: doc.valid_until,
        supersedes: doc.supersedes,
        evidence_level: doc.evidence_level,
        content_hash: doc.content_hash,
        file: doc.file_path,
      })),
    };
    writeFileAtomic(this.paths.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    const order: Record<string, number> = { user_explicit: 0, user_confirmed: 1, observed: 2, inferred: 3 };
    const sorted = [...active].sort((left, right) => {
      const rank = (order[left.evidence_level] ?? 9) - (order[right.evidence_level] ?? 9);
      if (rank !== 0) return rank;
      if (left.valid_from !== right.valid_from) return right.valid_from.localeCompare(left.valid_from);
      return left.id.localeCompare(right.id);
    });
    const lines = ['<!-- generated by mem; do not edit -->', '', '## MEMORY', ''];
    for (const doc of sorted) lines.push(`- [${doc.kind}] ${doc.abstract} — ${doc.id}`);
    writeFileAtomic(this.paths.memoryIndexFile, `${lines.join('\n')}\n`);
  }

  private validateInput(input: RecordInput): void {
    if (!KINDS.includes(input.kind)) {
      throw new MemoryStoreError('INVALID', `kind must be one of ${KINDS.join(', ')}`);
    }
    if (typeof input.abstract !== 'string' || input.abstract.trim() === '') {
      throw new MemoryStoreError('INVALID', 'abstract must not be empty');
    }
    if (/[\r\n]/.test(input.abstract)) {
      throw new MemoryStoreError('INVALID', 'abstract must be a single line');
    }
    if ([...input.abstract].length > this.config.limits.abstract_chars) {
      throw new MemoryStoreError(
        'INVALID',
        `abstract exceeds limits.abstract_chars (${this.config.limits.abstract_chars})`,
      );
    }
    if (input.body !== undefined && [...input.body].length > this.config.limits.body_chars) {
      throw new MemoryStoreError(
        'INVALID',
        `body exceeds limits.body_chars (${this.config.limits.body_chars})`,
      );
    }
    if ((input.evidence_level as string) === 'inferred') {
      throw new MemoryStoreError('INVALID', 'inferred content must go through a proposal');
    }
    const signatures = input.error_signatures ?? [];
    if (signatures.length > 3) throw new MemoryStoreError('INVALID', 'error_signatures allows at most 3 entries');
    for (const signature of signatures) {
      if (signature.length === 0 || [...signature].length > 80) {
        throw new MemoryStoreError('INVALID', 'each error_signatures entry must be 1..80 characters');
      }
    }
    if (input.kind === 'pitfall' && signatures.length === 0) {
      throw new MemoryStoreError('INVALID', 'a pitfall must declare at least one error_signatures entry');
    }
    const findings = scanInput({
      abstract: input.abstract,
      body: input.body,
      error_signatures: signatures,
    });
    if (findings.length > 0) {
      throw new MemoryStoreError(
        'INVALID',
        `content rejected by scan: ${findings.map((finding) => `${finding.rule}@${finding.field}`).join(', ')}`,
      );
    }
  }

  private findMemoryFile(id: MemoryId): string | undefined {
    for (const kind of KINDS) {
      const file = join(this.paths.memoriesDir, kind, `${id}.md`);
      if (existsSync(file)) return file;
    }
    return undefined;
  }

  private findDuplicate(input: RecordInput, author: 'agent' | 'human'): MemoryDoc | undefined {
    // Content-only dedupe (user request): the date, author and evidence level
    // do not make the same text a new memory. Importing yesterday's export on
    // a new date must skip, not duplicate.
    void author;
    // The stored body always carries the file's single trailing newline.
    const body = input.body.endsWith('\n') ? input.body : `${input.body}\n`;
    for (const doc of this.docs.values()) {
      if (this.deleted.has(doc.id) || this.quarantined.has(doc.id)) continue;
      if (
        doc.kind === input.kind &&
        doc.abstract === input.abstract &&
        doc.body === body &&
        JSON.stringify(doc.error_signatures) === JSON.stringify(input.error_signatures ?? []) &&
        doc.supersedes.length === 0
      ) {
        return doc;
      }
    }
    return undefined;
  }

  private allocateId(now: Date): MemoryId {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = newMemoryId(now);
      const exists =
        this.docs.has(id) ||
        this.accounted.has(id) ||
        existsSync(join(this.paths.memoriesDir, 'fact', `${id}.md`)) ||
        existsSync(join(this.paths.memoriesDir, 'pitfall', `${id}.md`)) ||
        existsSync(join(this.paths.memoriesDir, 'exp', `${id}.md`));
      if (!exists) return id;
    }
    throw new MemoryStoreError('CONFLICT', 'could not allocate a unique memory id');
  }
}

function countPending(dir: string): number {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}
