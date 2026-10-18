import { listProposals } from '../../core/src/index.ts';
import type { MemoryDoc, MemoryId } from '../../core/src/model/types.ts';
import type { MemoryStore } from '../../core/src/store/store.ts';

/**
 * V2 P1 GUI data plane. Read-only projections over the core store for the
 * client workbench; every write still goes through the existing tool/command/
 * proposal paths. No file I/O here beyond the store API.
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

function summary(doc: MemoryDoc, serial: string) {
  return {
    serial,
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

  return [status, list, item, search, exportRoute];
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
