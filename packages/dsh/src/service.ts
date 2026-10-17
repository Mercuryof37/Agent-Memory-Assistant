import {
  assemble,
  bindEvidence,
  createProposal,
  loadRules,
  MemoryStore,
  startup,
  type Kind,
  type ProposalInput,
  type ProposalReplacement,
  type Runtime,
} from '../../core/src/index.ts';
import type { EvidenceEvent } from '../../core/src/actor.ts';
import type { ToolService } from './tools.ts';

/**
 * Host-side service used by the plugin tools (S4).
 *
 * The adapter may only call core; all file I/O happens inside `MemoryStore`.
 * Evidence binding goes through the host's durable session store
 * (`ctx.sessionPersistence.open(id, 'read').read(seq, 1)`), so the model can
 * only cite events that really exist in the calling session.
 */

export interface SessionEventLike {
  readonly type: string;
  readonly seq: number;
  readonly data: unknown;
}

export interface SessionHandleLike {
  read(offset?: number, length?: number): Promise<{ events: readonly SessionEventLike[] }>;
  close(): Promise<void>;
}

export interface SessionPersistenceLike {
  open(id: string, access: 'read'): Promise<SessionHandleLike>;
}

/** Live session store (`ctx.sessions`), the sanctioned fallback in §5.3. */
export interface SessionLike {
  readonly seq?: number;
  eventAt(seq: number): SessionEventLike | undefined;
}

export interface SessionStoreLike {
  get(id: string): SessionLike | undefined;
}

export interface HostSessionContext {
  readonly sessionId: string;
  readonly persistence?: SessionPersistenceLike;
  readonly sessions?: SessionStoreLike;
}

export interface PromptSectionLike {
  readonly name: string;
  readonly order: number;
  readonly text: string;
  readonly interpolate: false;
}

export interface HostService extends ToolService {
  readonly store: MemoryStore;
  readonly runtime: Runtime;
  readonly home: string;
  readonly mode: 'confirm' | 'direct' | 'readonly';
  readonly session: HostSessionContext;
  assembleSection(sessionId?: string): PromptSectionLike;
  /** One prompt section per human/maintained source, in injection order. */
  assembleSections(sessionId?: string): PromptSectionLike[];
}

interface ToolExecLike {
  readonly agent?: { readonly session?: { readonly id?: string } };
}

function speakerOf(type: string): 'user' | 'assistant' | 'tool' | 'system' {
  if (type.startsWith('assistant')) return 'assistant';
  if (type.startsWith('tool')) return 'tool';
  if (type.startsWith('system')) return 'system';
  return 'user';
}

function textOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const record = data as { content?: unknown; text?: unknown; message?: unknown };
  if (typeof record.content === 'string') return record.content;
  if (Array.isArray(record.content)) {
    return record.content
      .map((block) =>
        typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string'
          ? ((block as { text: string }).text)
          : '',
      )
      .filter((text) => text !== '')
      .join('\n');
  }
  if (typeof record.text === 'string') return record.text;
  if (typeof record.message === 'object' && record.message !== null) return textOf(record.message);
  return '';
}

export function openHostService(
  home: string,
  session: HostSessionContext,
  options: { readonly onFailure?: (error: unknown) => void } = {},
): HostService | null {
  let runtime: Runtime;
  try {
    runtime = startup({ home });
  } catch (error) {
    // The host keeps running with the probe fallback, but the failure must not
    // disappear: the caller surfaces it (repair command included) to the model.
    options.onFailure?.(error);
    return null;
  }
  const store = new MemoryStore({ home, config: runtime.config });

  const lookupEvent = async (sessionId: string, seq: number): Promise<EvidenceEvent> => {
    // Live session fallback is sanctioned by plan §5.3; it is also what desktop
    // compositions expose (`ctx.sessions`) when the durable service is absent.
    const live = session.sessions?.get(sessionId);
    if (live !== undefined) {
      const event = live.eventAt(seq);
      if (event === undefined || event.seq !== seq) {
        throw new Error(`event ${seq} does not exist in this session`);
      }
      return { seq: event.seq, speaker: speakerOf(event.type), text: textOf(event.data) };
    }
    if (session.persistence === undefined) {
      throw new Error('trusted source binding is unavailable in this host session');
    }
    const handle = await session.persistence.open(sessionId, 'read');
    try {
      const { events } = await handle.read(seq, 1);
      const event = events[0];
      if (event === undefined || event.seq !== seq) throw new Error(`event ${seq} does not exist in this session`);
      return { seq: event.seq, speaker: speakerOf(event.type), text: textOf(event.data) };
    } finally {
      await handle.close();
    }
  };

  return {
    store,
    runtime,
    home,
    mode: runtime.config.personalization.mode,
    session,
    config: runtime.config,
    recall(input) {
      return store.recall(input.query, {
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.kind === undefined ? {} : { kinds: [input.kind as Kind] }),
      });
    },
    read(id) {
      return store.read(id);
    },
    async record(input, actor, exec?: unknown) {
      const execLike = exec as ToolExecLike | undefined;
      const sessionId = execLike?.agent?.session?.id ?? actor.sessionId;
      const raw = input as {
        kind: Kind;
        abstract: string;
        body: string;
        valid_from?: string;
        error_signatures?: readonly string[];
        evidence: readonly { event_seq: number; quote: string }[];
      };
      const provenance = [];
      for (const entry of raw.evidence) {
        const event = await lookupEvent(sessionId, entry.event_seq);
        provenance.push(
          bindEvidence({
            sessionId,
            eventSeq: entry.event_seq,
            quote: entry.quote,
            lookup: () => event,
          }),
        );
      }
      return store.add(
        {
          kind: raw.kind,
          abstract: raw.abstract,
          body: raw.body,
          evidence_level: 'observed',
          ...(raw.valid_from === undefined ? {} : { valid_from: raw.valid_from }),
          ...(raw.error_signatures === undefined ? {} : { error_signatures: raw.error_signatures }),
        },
        { author: 'agent', provenance },
      );
    },
    context(exec, limit = 10) {
      const execLike = exec as ToolExecLike | undefined;
      const sessionId = execLike?.agent?.session?.id ?? session.sessionId;
      const live = session.sessions?.get(sessionId);
      if (live === undefined) return { events: [] };
      const events: Array<{ seq: number; speaker: string; preview: string }> = [];
      const end = live.seq ?? 0;
      for (let seq = 0; seq < end; seq += 1) {
        const event = live.eventAt(seq);
        if (event === undefined) continue;
        if (event.type !== 'user/message' && event.type !== 'system/message' && event.type !== 'tool/result') {
          continue;
        }
        const text = textOf(event.data);
        if (text === '') continue;
        events.push({ seq: event.seq, speaker: speakerOf(event.type), preview: text.slice(0, 120) });
      }
      return { events: events.slice(-limit) };
    },
    async propose(input, actor, exec?: unknown) {
      const execLike = exec as ToolExecLike | undefined;
      const sessionId = execLike?.agent?.session?.id ?? actor.sessionId;
      const raw = input as {
        op: 'supersede' | 'delete';
        ids: readonly string[];
        base_hashes: readonly string[];
        replacements?: readonly {
          kind: Kind;
          abstract: string;
          body: string;
          evidence_level: 'user_explicit' | 'user_confirmed' | 'observed';
          valid_from?: string;
          error_signatures?: readonly string[];
          evidence?: readonly { event_seq: number; quote: string }[];
        }[];
        reason?: string;
      };
      const replacements: ProposalReplacement[] = [];
      for (const replacement of raw.replacements ?? []) {
        const provenance = [];
        for (const entry of replacement.evidence ?? []) {
          const event = await lookupEvent(sessionId, entry.event_seq);
          provenance.push(
            bindEvidence({
              sessionId,
              eventSeq: entry.event_seq,
              quote: entry.quote,
              lookup: () => event,
            }),
          );
        }
        replacements.push({
          kind: replacement.kind,
          abstract: replacement.abstract,
          body: replacement.body,
          evidence_level: replacement.evidence_level,
          ...(replacement.valid_from === undefined ? {} : { valid_from: replacement.valid_from }),
          ...(replacement.error_signatures === undefined
            ? {}
            : { error_signatures: replacement.error_signatures }),
          provenance,
        });
      }
      const proposalInput: ProposalInput =
        raw.op === 'delete'
          ? {
              op: 'delete',
              target: raw.ids[0] as string,
              base_hash: raw.base_hashes[0] as string,
              reason: raw.reason ?? 'agent proposal',
            }
          : {
              op: 'supersede',
              targets: raw.ids,
              base_hashes: raw.base_hashes,
              replacements,
              ...(raw.reason === undefined ? {} : { reason: raw.reason }),
            };
      return createProposal({ store, config: runtime.config }, proposalInput);
    },
    rules() {
      return { rules: loadRules(home) };
    },
    assembleSection(sessionId = session.sessionId) {
      const result = assemble({
        home,
        config: runtime.config,
        policy: runtime.policy,
        source: store,
        sessionId,
      });
      return { name: 'agent-memory' as const, order: 100, text: result.text, interpolate: false as const };
    },
    assembleSections(sessionId = session.sessionId) {
      const result = assemble({
        home,
        config: runtime.config,
        policy: runtime.policy,
        source: store,
        sessionId,
      });
      const order = { SOUL: 100, GUIDANCE: 110, RULES: 150, USER: 200, MEMORY: 300 } as const;
      return (['SOUL', 'GUIDANCE', 'RULES', 'USER', 'MEMORY'] as const)
        .filter((key) => result.parts[key] !== '')
        .map((key) => ({
          name: `agent-memory:${key.toLowerCase()}`,
          order: order[key],
          text: result.parts[key],
          interpolate: false as const,
        }));
    },
  };
}
