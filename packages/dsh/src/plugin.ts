/**
 * DSH host plugin — S0 M1 probe.
 *
 * Deliberately tiny: proves the host loads a bundle, gives the model a tool,
 * injects one system-prompt section, and exposes the services the real adapter
 * will rely on (`commands` + `tokenMeter`). It is not the memory service.
 *
 * Contract (ADR-0003): a Host-only bundle exports `apply(ctx, config)`, may
 * declare `inject`, and registers through the context so Cordis owns the
 * disposers. Every service is reached through the context object, which keeps
 * this module loadable from a linked checkout without host node_modules on its
 * resolution path.
 */

import { randomUUID } from 'node:crypto';
import {
  addRejected,
  bindEvidence,
  buildCloseoutPrompt,
  CloseoutRound,
  collectL0,
  createProposal,
  HUMAN_COMMAND_HINT,
  listProposals,
  loadRejected,
  parseCloseout,
  resolveHome,
  runHumanCommand,
  summaryHash,
  type DistillEvent,
  type Proposal,
  type ProposalInput,
} from '../../core/src/index.ts';
import { registerTools } from './tools.ts';
import { reviewProposal, type ReviewExecLike, type UserQuestionsLike } from './review.ts';
import { registerUserProfileTool } from './personalization.ts';
import { registerSessionTools, type SessionQueryLike } from './session-tools.ts';
import { registerGuiRoutes, type GuiConnection } from './gui.ts';
import { openHostService, type SessionStoreLike } from './service.ts';

export const name = 'agent-memory';
export const inject = ['tools'];

const SECTION_NAME = 'agent-memory:probe';
const PROBE_LINE =
  'Agent Memory probe is active. If the user sends exactly "am-probe", reply exactly "am-probe-ok".';

export interface ToolDefinitionLike {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
  readonly output: {
    readonly schema: unknown;
    readonly render: (args: unknown, value: unknown) => unknown;
  };
  readonly execute: (args: any, exec: any) => unknown;
}

export interface ToolRegistryLike {
  register(definition: ToolDefinitionLike): unknown;
}

export interface PromptRegistryLike {
  section(spec: {
    readonly name: string;
    readonly order: number;
    readonly text: string;
    readonly interpolate?: boolean;
  }): unknown;
}

export interface CommandsLike {
  register(spec: {
    readonly name: string;
    readonly description: string;
    readonly input?: { readonly hint: string };
    readonly handler: (invocation: any) => unknown;
  }): unknown;
  execute?(
    agent: unknown,
    line: string,
    attachments: readonly unknown[],
    signal: AbortSignal,
  ): Promise<{ readonly result: { readonly kind?: string; readonly text?: string } } | undefined>;
}

export interface TokenMeterLike {
  measure(session: unknown): { readonly totalTokens?: number; readonly surfaceTokens?: number };
}

export interface PluginContextLike {
  readonly tools: ToolRegistryLike;
  get?(name: string): unknown;
  readonly systemPrompt?: PromptRegistryLike;
  readonly commands?: CommandsLike;
  readonly tokenMeter?: TokenMeterLike;
}

/**
 * Resolve an optional service without touching an undeclared property.
 *
 * Cordis throws "cannot get property X without inject" on a bare `ctx.X`
 * access, so `ctx.get(name)` is tried first (the same lookup YAML `!!js`
 * expressions use). The direct property access stays as a fallback for
 * contexts without `get`, guarded because it can throw for the same reason.
 */
function service<T>(ctx: PluginContextLike, name: string): T | undefined {
  try {
    const resolved = ctx.get?.(name);
    if (resolved !== undefined) return resolved as T;
  } catch {
    // fall through to the guarded property access
  }
  try {
    const direct = (ctx as unknown as Record<string, unknown>)[name];
    return direct === undefined ? undefined : (direct as T);
  } catch {
    return undefined;
  }
}

function eventTextOf(data: unknown): string {
  if (typeof data !== 'object' || data === null) return '';
  const record = data as { content?: unknown; text?: unknown };
  if (Array.isArray(record.content)) {
    return record.content
      .map((block) =>
        typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string'
          ? (block as { text: string }).text
          : '',
      )
      .filter((text) => text !== '')
      .join('\n');
  }
  return typeof record.text === 'string' ? record.text : '';
}

function eventsOf(sessions: SessionStoreLike | undefined, sessionId: string): DistillEvent[] {
  const live = sessions?.get(sessionId);
  if (live === undefined) return [];
  const events: DistillEvent[] = [];
  for (let seq = 0; seq < (live.seq ?? 0); seq += 1) {
    const event = live.eventAt(seq);
    if (event === undefined) continue;
    const speaker = event.type.startsWith('assistant')
      ? 'assistant'
      : event.type.startsWith('tool')
        ? 'tool'
        : event.type.startsWith('system')
          ? 'system'
          : 'user';
    events.push({ seq: event.seq, speaker, text: eventTextOf(event.data) });
  }
  return events;
}

export function apply(ctx: PluginContextLike): void {
  // S4: real tool surface + injection when a store is configured. If startup
  // fails (no home, bad policy, sealed file changed) fall back to the probe so a
  // broken store never takes the host down.
  const home = resolveHome({ env: process.env });
  // Cordis forbids undeclared service property reads; go through the guarded
  // resolver (ctx.get first) so a composition without a session still loads.
  const sessionService = service<{ id?: string }>(ctx, 'session');
  const sessionId = sessionService?.id ?? `dsh-${process.pid}`;
  const persistence = service<import('./service.ts').SessionPersistenceLike>(ctx, 'sessionPersistence');
  const sessions = service<import('./service.ts').SessionStoreLike>(ctx, 'sessions');
  let startupFailure: string | undefined;
  const host = openHostService(
    home,
    {
      sessionId,
      ...(persistence === undefined ? {} : { persistence }),
      ...(sessions === undefined ? {} : { sessions }),
    },
    {
      onFailure: (error) => {
        const formatted = error as { format?: () => string; message?: string };
        startupFailure = typeof formatted.format === 'function' ? formatted.format() : (formatted.message ?? String(error));
      },
    },
  );
  if (host !== null) {
    // Registration-time services (the command plane). Interaction services are
    // resolved per call: Cordis may not have activated the provider fiber yet
    // when this plugin applies, and `userQuestions` (Typert) comes up later.
    const commands = service<CommandsLike>(ctx, 'commands');
    const resolveQuestions = (): UserQuestionsLike | undefined =>
      service<UserQuestionsLike>(ctx, 'userQuestions');
    const resolveCommands = (): CommandsLike | undefined => service<CommandsLike>(ctx, 'commands');
    const reviewDeps = () => {
      const userQuestions = resolveQuestions();
      const commandsNow = resolveCommands();
      return {
        store: host.store,
        config: host.runtime.config,
        home,
        ...(userQuestions === undefined ? {} : { userQuestions }),
        ...(commandsNow === undefined ? {} : { commands: commandsNow }),
      };
    };
    // Module health (architecture v2 P0.5): one failing optional module must
    // not take the others down. `/api/agent-memory/status` exposes this list.
    const moduleHealth: { name: string; ok: boolean; error?: string }[] = [];
    const guard = (name: string, run: () => void): void => {
      try {
        run();
        moduleHealth.push({ name, ok: true });
      } catch (error) {
        moduleHealth.push({
          name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    // S9 review card: propose opens a Chinese button card and the click runs
    // `/mem decide …`; the model never supplies the verdict (ADR-0012).
    registerTools(ctx as never, host, { sessionId, delegationDepth: 0 }, undefined, {
      reviewProposal: (proposal, exec) =>
        reviewProposal(reviewDeps(), proposal as Proposal, exec as ReviewExecLike | undefined),
      reviewPending: async (proposalId, exec) => {
        const pending = listProposals(host.store);
        const proposal =
          proposalId === undefined ? pending[0] : pending.find((entry) => entry.id === proposalId);
        if (proposal === undefined) {
          throw new Error(
            proposalId === undefined ? '当前没有待审提案' : `没有待审提案 ${proposalId}（可能已被决定或作废）`,
          );
        }
        return reviewProposal(reviewDeps(), proposal, exec as ReviewExecLike | undefined);
      },
    });
    // P1: USER.md profile tool (read always; writes need a prior read + card).
    const readSessions = new Set<string>();
    guard('user-profile', () =>
      registerUserProfileTool(ctx as never, {
        home,
        store: host.store,
        resolveQuestions,
        mode: host.mode,
        readSessions,
      }),
    );
    // P2: session-history tools over the host's native sessionQuery service.
    guard('session-tools', () =>
      registerSessionTools(ctx as never, {
        resolveQuery: () => service<SessionQueryLike>(ctx, 'sessionQuery'),
        sessionId,
      }),
    );
    // V2 GUI routes: status/list/item/search/export. Exact routes own their
    // full `/api/...` path (see dsh-api-session-controller).
    const effectful = ctx as unknown as {
      effect?: (install: () => unknown, label?: string) => unknown;
    };
    const effect = (install: () => unknown, label?: string): unknown =>
      typeof effectful.effect === 'function' ? effectful.effect(install, label) : install();
    const installRoutes = (connection: GuiConnection): void => {
      registerGuiRoutes(
        connection,
        { store: host.store, home, mode: host.mode, modules: moduleHealth, config: host.runtime.config },
        effect,
      );
      try {
        host.store.appendAudit({ event: 'gui-route', state: 'registered', path: '/api/agent-memory/*' });
      } catch {
        // Journal problems are reported by `mem doctor`.
      }
    };
    const connectionNow = service<GuiConnection>(ctx, 'connection');
    if (connectionNow !== undefined) installRoutes(connectionNow);
    else {
      (ctx as unknown as {
        inject?: (deps: string[], callback: (child: unknown) => void) => unknown;
      }).inject?.(['connection'], (child) => {
        // The injected child is a Context; the service hangs off `.connection`,
        // not off the child itself.
        const connection = (child as { connection?: GuiConnection }).connection;
        if (connection !== undefined) installRoutes(connection);
      });
    }
    try {
      host.store.appendAudit({
        event: 'gui-route',
        path: '/api/agent-memory/*',
        at: connectionNow !== undefined ? 'apply' : 'deferred',
      });
    } catch {
      // A journal problem is reported by `mem doctor`; the panel can still load.
    }
    guard('injection', () => {
      const prompt = service<PromptRegistryLike>(ctx, 'systemPrompt');
      for (const section of host.assembleSections()) prompt?.section(section);
    });

    // S6 closeout: `/closeout` opens a round, registers `closeout_submit` only
    // for that round, and disposes it after submit (or when a new round opens).
    type RoundEntry = { round: CloseoutRound; dispose: (() => void) | undefined };
    const rounds = new Map<string, RoundEntry>();
    const rejected = loadRejected(home);

    const disposeRound = (id: string): void => {
      const entry = rounds.get(id);
      if (entry === undefined) return;
      entry.round.dispose();
      entry.dispose?.();
      rounds.delete(id);
    };

    // S8 human command plane: the CLI-level operations run from the chat box.
    // Commands execute in the UI plane, never as a model message, and `decide`
    // is still not a tool (ADR-0011).
    commands?.register({
      name: 'mem',
      description: 'Agent Memory：审提案、采纳/否决、写入、查看与运维（人操作）',
      input: { hint: HUMAN_COMMAND_HINT },
      handler: (invocation: { rawInput?: string }) => {
        const result = runHumanCommand(
          { store: host.store, config: host.runtime.config, home },
          invocation.rawInput ?? '',
        );
        return { kind: result.ok ? 'success' : 'error', text: result.text };
      },
    });
    commands?.register({
      name: 'closeout',
      description: 'Run one closeout distillation round over the current session.',
      handler: (invocation: {
        agent?: { session?: { id?: string }; followup?: (input: unknown) => unknown };
      }) => {
        const sid = invocation.agent?.session?.id ?? sessionId;
        disposeRound(sid);
        const round = new CloseoutRound({ timeoutMs: 300_000 });
        const definition = {
          name: 'closeout_submit',
          description: 'Submit the closeout distillation JSON for the current round.',
          parameters: {
            type: 'object',
            properties: { payload: { type: 'object' } },
            required: ['payload'],
            additionalProperties: false,
          },
          output: {
            schema: { type: 'object' },
            render: (_args: unknown, value: unknown) => [
              { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
            ],
          },
          execute: async (args: { payload?: unknown }, exec?: { agent?: { session?: { id?: string } } }) => {
            const callSid = exec?.agent?.session?.id ?? sid;
            const entry = rounds.get(callSid);
            if (entry === undefined || entry.round.status !== 'open') {
              throw new Error('no active closeout round');
            }
            const accepted = entry.round.submit();
            if (!accepted.ok) throw new Error(accepted.error);

            const events = eventsOf(sessions, callSid);
            const active = host.store.active();
            const parsed = parseCloseout(JSON.stringify(args.payload ?? {}), {
              events,
              activeIds: active.map((doc) => doc.id),
              activeAbstracts: active.map((doc) => doc.abstract),
              rejectedHashes: rejected,
              maxProposals: host.runtime.config.distill.max_proposals,
            });
            const created: string[] = [];
            const hashes: string[] = [];
            const eventsBySeq = new Map(events.map((event) => [event.seq, event]));
            for (const candidate of parsed.candidates) {
              const base_hashes = candidate.targets.map((id) => host.store.read(id).content_hash);
              const input: ProposalInput =
                candidate.op === 'delete'
                  ? {
                      op: 'delete',
                      target: candidate.targets[0] as string,
                      base_hash: base_hashes[0] as string,
                      reason: candidate.reason,
                    }
                  : {
                      op: 'supersede',
                      targets: candidate.targets,
                      base_hashes,
                      replacements: candidate.replacements.map((replacement) => ({
                        kind: replacement.kind,
                        abstract: replacement.abstract,
                        body: replacement.body,
                        evidence_level: 'observed',
                        provenance: replacement.evidence.map((entry) =>
                          bindEvidence({
                            sessionId: callSid,
                            eventSeq: entry.event_seq,
                            quote: entry.quote,
                            lookup: () => eventsBySeq.get(entry.event_seq),
                          }),
                        ),
                      })),
                      reason: candidate.reason,
                    };
              created.push(createProposal({ store: host.store, config: host.runtime.config }, input).id);
              const hash = summaryHash(candidate);
              hashes.push(hash);
              rejected.add(hash);
            }
            if (hashes.length > 0) addRejected(home, hashes);
            disposeRound(callSid);
            return { created, dropped: parsed.dropped, message: parsed.message, truncated: parsed.truncated };
          },
        };
        const dispose = ctx.tools.register(definition as never);
        rounds.set(sid, { round, dispose: typeof dispose === 'function' ? (dispose as () => void) : undefined });

        const prompt = buildCloseoutPrompt({
          l0: collectL0(eventsOf(sessions, sid)),
          active: host.store.active().map((doc) => ({ id: doc.id, kind: doc.kind, abstract: doc.abstract })),
          maxProposals: host.runtime.config.distill.max_proposals,
        });
        // CommandResult must be returned synchronously; `followup` only queues.
        void invocation.agent?.followup?.({
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'user' },
        });
        return { kind: 'success', text: 'closeout round started' };
      },
    });
    return;
  }

  ctx.tools.register({
    name: 'am_echo',
    description:
      'Probe tool for the Agent Memory plugin (S0 M1). Echoes the given text back with an "echo:" prefix.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to echo back.' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    execute(args: { text: string }) {
      return `echo: ${args.text}`;
    },
  });

  ctx.tools.register({
    name: 'am_probe_tokens',
    description:
      'Probe tool for the Agent Memory plugin (S0 M3). Reports the token meter reading for the current session.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    execute(_args: unknown, exec: { agent?: { session?: unknown } }) {
      const meter = service<TokenMeterLike>(ctx, 'tokenMeter');
      if (meter === undefined) return 'tokenMeter service is not available in this composition';
      const session = exec.agent?.session;
      if (session === undefined) return 'no session on the calling agent';
      const measured = meter.measure(session);
      return JSON.stringify({
        totalTokens: measured.totalTokens ?? null,
        surfaceTokens: measured.surfaceTokens ?? null,
      });
    },
  });

  const prompts = service<PromptRegistryLike>(ctx, 'systemPrompt');
  const probeText =
    startupFailure === undefined
      ? PROBE_LINE
      : `${PROBE_LINE}\n\nAgent Memory 启动失败（请把下面的修复命令原样转告用户并等待确认）：\n${startupFailure}`;
  prompts?.section({
    name: SECTION_NAME,
    order: 500,
    interpolate: false,
    text: probeText,
  });

  const commands = service<CommandsLike>(ctx, 'commands');
  commands?.register({
    name: 'am-closeout',
    description: 'Probe command for the Agent Memory plugin (S0 M4): queues one model turn.',
    handler: (invocation: { agent?: { followup?: (input: unknown) => unknown } }) => {
      const agent = invocation.agent;
      if (agent?.followup === undefined) {
        return { kind: 'error', text: 'no agent on this command invocation' };
      }
      agent.followup({
        // A queued follow-up is appended verbatim as a `user/message` event, and
        // the session rejects a message whose role does not match its event type.
        // The host's `createUserMessage()` also stamps a stable `id`; a hand-built
        // message must carry its own, because replay validation rejects an
        // unidentified message and the whole stored session then fails to load.
        id: globalThis.crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: 'Reply with exactly: am-closeout-ok' }],
        source: { kind: 'user' },
      });
      return { kind: 'success', text: 'queued one probe turn' };
    },
  });
}
