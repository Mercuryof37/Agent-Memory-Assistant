import {
  createProposal,
  decideProposal,
  importBundle,
  listProposals,
  loadProfile,
  readRulesFile,
  saveProfile,
  saveRulesFile,
  sealPolicy,
} from '../../core/src/index.ts';
import type { Config } from '../../core/src/config/config.ts';
import type { MemoryDoc, MemoryId } from '../../core/src/model/types.ts';
import type { MemoryStore } from '../../core/src/store/store.ts';

/**
 * V2 GUI data plane. P1 projections are read-only; P2 adds human write routes
 * that reuse the existing proposal + decision pipeline and journal. No file
 * I/O here beyond the core API.
 */

const KIND_ORDER = ['fact', 'pitfall', 'exp'] as const;
const KIND_LABEL: Record<string, string> = { fact: '事实', pitfall: '坑', exp: '经验' };
const KIND_PREFIX: Record<string, string> = { fact: 'F', pitfall: 'P', exp: 'E' };

function byDateDesc(left: MemoryDoc, right: MemoryDoc): number {
  if (left.created_at !== right.created_at) return right.created_at.localeCompare(left.created_at);
  return right.id.localeCompare(left.id);
}

/** Stable human-readable serial: F-01, P-02, … in date-desc order within a kind. */
export function serialsFor(docs: readonly MemoryDoc[]): ReadonlyMap<MemoryId, string> {
  const serials = new Map<MemoryId, string>();
  for (const kind of KIND_ORDER) {
    const sorted = docs.filter((doc) => doc.kind === kind).sort(byDateDesc);
    sorted.forEach((doc, index) => {
      serials.set(doc.id, `${KIND_PREFIX[kind]}-${String(index + 1).padStart(2, '0')}`);
    });
  }
  return serials;
}

/** Human-facing summary: whitespace collapsed, hard cap of 12 characters. */
export function summarize(text: string, limit = 12): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const points = [...clean];
  return points.length <= limit ? clean : points.slice(0, limit).join('');
}

/** Existing memory: `F-01 中文优先偏好`; new content: just the summary. */
export function displayName(serial: string, abstract: string): string {
  const text = summarize(abstract);
  return serial === '' ? text : `${serial} ${text}`;
}

function summary(doc: MemoryDoc, serial: string) {
  return {
    serial,
    display: displayName(serial, doc.abstract),
    id: doc.id,
    kind: doc.kind,
    abstract: doc.abstract,
    author: doc.author,
    valid_from: doc.valid_from,
    valid_until: doc.valid_until,
    evidence_level: doc.evidence_level,
    created_at: doc.created_at,
    supersedes: doc.supersedes,
  };
}

export function buildList(store: MemoryStore) {
  const active = store.active();
  const serials = serialsFor(active);
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABEL[kind] ?? kind,
    items: active
      .filter((doc) => doc.kind === kind)
      .sort(byDateDesc)
      .map((doc) => summary(doc, serials.get(doc.id) ?? '')),
  }));
  return {
    total: active.length,
    pending: store.stats().pending_proposals,
    groups,
  };
}

export function buildItem(store: MemoryStore, id: string) {
  const doc = store.read(id as MemoryId);
  const serial = serialsFor(store.active()).get(doc.id) ?? '';
  return {
    ...summary(doc, serial),
    body: doc.body,
    error_signatures: doc.error_signatures,
    provenance: doc.provenance,
    content_hash: doc.content_hash,
  };
}

export function buildSearch(store: MemoryStore, query: string, limit = 20) {
  const result = store.recall(query, { limit });
  const serials = serialsFor(store.active());
  return {
    query,
    hits: result.hits.map((hit) => ({
      serial: serials.get(hit.id) ?? '',
      id: hit.id,
      kind: hit.kind,
      abstract: hit.abstract,
      score: hit.score,
      provenance_verifiable: hit.provenance_verifiable,
    })),
    warnings: result.warnings,
  };
}

export function exportBundle(store: MemoryStore) {
  const active = store.active();
  const serials = serialsFor(active);
  const memories = active
    .slice()
    .sort(byDateDesc)
    .map((doc) => ({
      ...summary(doc, serials.get(doc.id) ?? ''),
      body: doc.body,
      error_signatures: doc.error_signatures,
      provenance: doc.provenance,
      content_hash: doc.content_hash,
    }));
  return {
    format: 'agent-memory-export-v1',
    exported_at: new Date().toISOString(),
    memories,
    proposals: listProposals(store).map((proposal) => ({
      id: proposal.id,
      op: proposal.op,
      targets: proposal.targets,
      reason: proposal.reason,
      created_at: proposal.created_at,
    })),
  };
}

export interface GuiRouteDeps {
  readonly store: MemoryStore;
  readonly home: string;
  readonly mode: string;
  readonly modules: readonly { name: string; ok: boolean; error?: string }[];
  readonly config: Config;
}

/** Pending proposals with display serials and target abstracts. */
export function buildProposals(store: MemoryStore) {
  const serials = serialsFor(store.active());
  const abstractOf = (id: string): string => {
    try {
      return store.read(id as MemoryId).abstract;
    } catch {
      return '（已不存在）';
    }
  };
  return listProposals(store).map((proposal) => ({
    id: proposal.id,
    op: proposal.op,
    reason: proposal.reason,
    created_at: proposal.created_at,
    targets: proposal.targets.map((id) => {
      const serial = serials.get(id) ?? '';
      const abstract = abstractOf(id);
      return { id, serial, abstract, display: displayName(serial, abstract) };
    }),
    replacements: proposal.replacements.map((replacement) => ({
      kind: replacement.kind,
      abstract: replacement.abstract,
      display: summarize(replacement.abstract),
      body: replacement.body,
    })),
  }));
}

/** Human GUI decision: same proposal pipeline as `/mem decide`, audited as GUI. */
export function decideGui(
  store: MemoryStore,
  config: Config,
  id: string,
  decision: 'accept' | 'reject',
  note?: string,
): void {
  decideProposal({ store, config }, { id, decision, ...(note === undefined ? {} : { reason: note }) });
  store.appendJournal('audit', { event: 'gui-decide', proposal: id, decision });
}

/**
 * Human GUI revise: create the supersede proposal, then accept it in the same
 * human action. Provenance survives from the old record; the decision line is
 * the GUI confirmation.
 */
export function reviseGui(
  store: MemoryStore,
  config: Config,
  id: string,
  input: { abstract: string; body: string },
): void {
  const target = store.read(id as MemoryId);
  const proposal = createProposal(
    { store, config },
    {
      op: 'supersede',
      targets: [id],
      base_hashes: [target.content_hash],
      reason: '图形界面修订',
      replacements: [
        {
          kind: target.kind,
          abstract: input.abstract,
          body: input.body,
          evidence_level: 'user_confirmed',
          error_signatures: target.error_signatures,
          provenance: target.provenance,
        },
      ],
    },
  );
  decideProposal({ store, config }, { id: proposal.id, decision: 'accept' });
  store.appendJournal('audit', { event: 'gui-revise', target: id, proposal: proposal.id });
}

/** Human GUI delete: delete proposal + immediate acceptance. */
export function deleteGui(store: MemoryStore, config: Config, id: string, reason = '图形界面删除'): void {
  const target = store.read(id as MemoryId);
  const proposal = createProposal(
    { store, config },
    { op: 'delete', target: id, base_hash: target.content_hash, reason },
  );
  decideProposal({ store, config }, { id: proposal.id, decision: 'accept' });
  store.appendJournal('audit', { event: 'gui-delete', target: id, proposal: proposal.id });
}

export function readProfileGui(home: string) {
  const profile = loadProfile(home);
  return { entries: [...profile.entries], chars: profile.chars };
}

export function saveProfileGui(home: string, store: MemoryStore, entries: readonly string[]) {
  const profile = saveProfile(home, entries);
  store.appendJournal('audit', { event: 'gui-profile', entries: profile.entries.length });
  return profile;
}

export function readRulesGui(home: string) {
  return { text: readRulesFile(home) };
}

/**
 * Human GUI RULES write. Only reachable from the GUI route (no model tool and
 * no CLI command), validates first, then seals policy with the human click as
 * the explicit acceptance.
 */
export function saveRulesGui(home: string, store: MemoryStore, text: string) {
  saveRulesFile(home, text);
  const sealed = sealPolicy({ home, accept: true });
  store.appendJournal('audit', { event: 'gui-rules', sha256: sealed.sha256 });
  return { sealed: true };
}


export interface GuiConnection {
  readonly fetch?: { register(route: unknown): unknown };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function errorResponse(message: string, status = 400): Response {
  return json({ ok: false, error: message }, status);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = (await request.json()) as unknown;
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Register the P1 read-only routes (paths own their full `/api` prefix). */
export function guiRoutes(deps: GuiRouteDeps): unknown[] {
  const status = {
    path: '/api/agent-memory/status',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const stats = deps.store.stats();
      return json({
        ok: true,
        home: deps.home,
        active: stats.active,
        pending: stats.pending_proposals,
        journal_head: stats.journal_head,
        mode: deps.mode,
        modules: deps.modules,
      });
    },
  };

  const list = {
    path: '/api/agent-memory/list',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => json(buildList(deps.store)),
  };

  const item = {
    path: '/api/agent-memory/item',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const id = new URL(request.url).searchParams.get('id') ?? '';
      if (!/^mem-\d{8}-[0-9a-f]{8}$/.test(id)) return errorResponse('id must be a memory id');
      try {
        return json(buildItem(deps.store, id));
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error), 404);
      }
    },
  };

  const search = {
    path: '/api/agent-memory/search',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const query = (new URL(request.url).searchParams.get('q') ?? '').trim();
      if (query === '') return errorResponse('q is required');
      return json(buildSearch(deps.store, query));
    },
  };

  const exportRoute = {
    path: '/api/agent-memory/export',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      const body = JSON.stringify(exportBundle(deps.store), null, 2);
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="agent-memory-${new Date().toISOString().slice(0, 10)}.json"`,
          'cache-control': 'no-store',
        },
      });
    },
  };

  const proposalsRoute = {
    path: '/api/agent-memory/proposals',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => json(buildProposals(deps.store)),
  };

  const decideRoute = {
    path: '/api/agent-memory/proposals/decide',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const body = await readJson(request);
      const id = typeof body.id === 'string' ? body.id : '';
      const decision = body.decision === 'accept' || body.decision === 'reject' ? body.decision : null;
      if (id === '' || decision === null) return errorResponse('id and decision are required');
      try {
        decideGui(deps.store, deps.config, id, decision, typeof body.note === 'string' ? body.note : undefined);
        return json({ ok: true });
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error), 409);
      }
    },
  };

  const reviseRoute = {
    path: '/api/agent-memory/revise',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const body = await readJson(request);
      const id = typeof body.id === 'string' ? body.id : '';
      const abstract = typeof body.abstract === 'string' ? body.abstract.trim() : '';
      const text = typeof body.body === 'string' ? body.body : '';
      if (id === '' || abstract === '') return errorResponse('id and abstract are required');
      try {
        reviseGui(deps.store, deps.config, id, { abstract, body: text });
        return json({ ok: true });
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error), 409);
      }
    },
  };

  const deleteRoute = {
    path: '/api/agent-memory/delete',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const body = await readJson(request);
      const id = typeof body.id === 'string' ? body.id : '';
      if (id === '') return errorResponse('id is required');
      try {
        deleteGui(deps.store, deps.config, id);
        return json({ ok: true });
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error), 409);
      }
    },
  };

  const importRoute = {
    path: '/api/agent-memory/import',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      const body = await readJson(request);
      try {
        const report = importBundle(deps.store, body);
        deps.store.appendJournal('audit', {
          event: 'gui-import',
          imported: report.imported,
          skipped: report.skipped,
          failed: report.failed.length,
        });
        return json(report);
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error));
      }
    },
  };

  const profileRoute = {
    path: '/api/agent-memory/profile',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      if (request.method === 'GET') return json(readProfileGui(deps.home));
      const body = await readJson(request);
      const entries = Array.isArray(body.entries)
        ? body.entries.filter((entry): entry is string => typeof entry === 'string')
        : null;
      if (entries === null) return errorResponse('entries must be a string array');
      try {
        return json(saveProfileGui(deps.home, deps.store, entries));
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error));
      }
    },
  };

  const rulesRoute = {
    path: '/api/agent-memory/rules',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: async (request: Request) => {
      if (request.method === 'GET') return json(readRulesGui(deps.home));
      const body = await readJson(request);
      const text = typeof body.text === 'string' ? body.text : null;
      if (text === null) return errorResponse('text is required');
      try {
        return json(saveRulesGui(deps.home, deps.store, text));
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error), 409);
      }
    },
  };

  return [
    status,
    list,
    item,
    search,
    exportRoute,
    proposalsRoute,
    decideRoute,
    reviseRoute,
    deleteRoute,
    importRoute,
    profileRoute,
    rulesRoute,
  ];
}

export function registerGuiRoutes(
  connection: GuiConnection,
  deps: GuiRouteDeps,
  effect: ((install: () => unknown, label?: string) => unknown) | undefined,
): void {
  if (connection.fetch === undefined) return;
  const install = (): void => {
    for (const route of guiRoutes(deps)) connection.fetch?.register(route);
  };
  if (effect !== undefined) effect(install, 'agent-memory: gui routes');
  else install();
}
