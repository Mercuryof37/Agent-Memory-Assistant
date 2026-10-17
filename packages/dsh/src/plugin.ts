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
    readonly handler: (invocation: any) => unknown;
  }): unknown;
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

export function apply(ctx: PluginContextLike): void {
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
  prompts?.section({
    name: SECTION_NAME,
    order: 500,
    interpolate: false,
    text: PROBE_LINE,
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
