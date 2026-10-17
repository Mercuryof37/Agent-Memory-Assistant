import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject, type ToolDefinitionLike } from '../src/plugin.ts';

// The probe tests run with a path that cannot be a store, so `apply` takes the
// fallback branch and registers the S0 probe instead of the real tool surface.
process.env.AGENT_MEMORY_HOME = 'C:\\__agent-memory-plugin-test-missing__';

interface Recorded {
  readonly tools: ToolDefinitionLike[];
  readonly sections: Array<Record<string, unknown>>;
  readonly commands: Array<Record<string, unknown>>;
}

function makeContext(overrides: Record<string, unknown> = {}): { ctx: Record<string, unknown>; recorded: Recorded } {
  const recorded: Recorded = { tools: [], sections: [], commands: [] };
  const ctx: Record<string, unknown> = {
    tools: {
      register(definition: ToolDefinitionLike) {
        recorded.tools.push(definition);
        return () => {};
      },
    },
    systemPrompt: {
      section(spec: Record<string, unknown>) {
        recorded.sections.push(spec);
        return () => {};
      },
    },
    commands: {
      register(spec: Record<string, unknown>) {
        recorded.commands.push(spec);
        return () => {};
      },
    },
    tokenMeter: {
      measure: () => ({ totalTokens: 42, surfaceTokens: 30 }),
    },
    ...overrides,
  };
  return { ctx, recorded };
}

test('the probe plugin registers its two tools, one section and one command', () => {
  const { ctx, recorded } = makeContext();
  apply(ctx as never);

  assert.deepEqual(inject, ['tools']);
  assert.deepEqual(
    recorded.tools.map((tool) => tool.name),
    ['am_echo', 'am_probe_tokens'],
  );
  assert.equal(recorded.sections.length, 1);
  assert.equal(recorded.sections[0]?.name, 'agent-memory:probe');
  assert.equal(recorded.sections[0]?.interpolate, false);
  // A failed store startup must not disappear: the probe section carries the
  // formatted failure so the model can relay it (repair command included).
  assert.match(String(recorded.sections[0]?.text ?? ''), /启动失败/);
  assert.equal(recorded.commands.length, 1);
  assert.equal(recorded.commands[0]?.name, 'am-closeout');
});

test('am_echo echoes and renders a text block', () => {
  const { ctx, recorded } = makeContext();
  apply(ctx as never);
  const echo = recorded.tools[0];
  assert.ok(echo);
  assert.equal(echo.execute({ text: 'hi' }, {}), 'echo: hi');
  assert.deepEqual(echo.output.render({}, 'echo: hi'), [{ type: 'text', text: 'echo: hi' }]);
});

test('am_probe_tokens reports the token meter reading for the calling session', () => {
  const { ctx, recorded } = makeContext();
  apply(ctx as never);
  const probe = recorded.tools[1];
  assert.ok(probe);
  const result = probe.execute({}, { agent: { session: { id: 's1' } } });
  assert.deepEqual(JSON.parse(String(result)), { totalTokens: 42, surfaceTokens: 30 });
});

test('am_probe_tokens degrades cleanly without the meter or a session', () => {
  const { ctx, recorded } = makeContext({ tokenMeter: undefined });
  apply(ctx as never);
  const probe = recorded.tools[1];
  assert.ok(probe);
  assert.match(String(probe.execute({}, { agent: { session: { id: 's1' } } })), /not available/);

  const second = makeContext();
  apply(second.ctx as never);
  const probe2 = second.recorded.tools[1];
  assert.ok(probe2);
  assert.match(String(probe2.execute({}, {})), /no session/);
});

test('the command queues one follow-up turn on the agent', () => {
  const { ctx, recorded } = makeContext();
  apply(ctx as never);
  const command = recorded.commands[0] as { handler: (invocation: unknown) => unknown };
  const calls: unknown[] = [];
  const result = command.handler({
    agent: {
      followup: (input: unknown) => {
        calls.push(input);
      },
    },
  });
  assert.deepEqual(result, { kind: 'success', text: 'queued one probe turn' });
  assert.equal(calls.length, 1);
  const input = calls[0] as {
    id: string;
    role: string;
    content: Array<{ type: string; text: string }>;
    source: { kind: string };
  };
  assert.equal(input.role, 'user');
  assert.match(input.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.match(input.content[0]?.text ?? '', /am-closeout-ok/);
  assert.equal(input.source.kind, 'user');
});

test('each queued follow-up carries its own message identity', () => {
  const { ctx, recorded } = makeContext();
  apply(ctx as never);
  const command = recorded.commands[0] as { handler: (invocation: unknown) => unknown };
  const ids: unknown[] = [];
  const invoke = () =>
    command.handler({
      agent: {
        followup: (input: unknown) => {
          ids.push((input as { id?: unknown }).id);
        },
      },
    });
  invoke();
  invoke();
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test('a composition without optional services still loads the tools', () => {
  const { ctx, recorded } = makeContext({
    systemPrompt: undefined,
    commands: undefined,
    tokenMeter: undefined,
  });
  apply(ctx as never);
  assert.equal(recorded.tools.length, 2);
  assert.equal(recorded.sections.length, 0);
  assert.equal(recorded.commands.length, 0);
});

test('a Cordis-like context that throws on undeclared service access still registers tools', () => {
  // Cordis raises on `ctx.<service>` when the service is not in `inject`.
  // Probe regression: that throw used to fail plugin activation entirely.
  const tools: ToolDefinitionLike[] = [];
  const ctx: Record<string, unknown> = {
    tools: {
      register(definition: ToolDefinitionLike) {
        tools.push(definition);
        return () => {};
      },
    },
    get() {
      throw new Error('cannot get property "systemPrompt" without inject');
    },
  };
  for (const name of ['systemPrompt', 'commands', 'tokenMeter']) {
    Object.defineProperty(ctx, name, {
      get() {
        throw new Error(`cannot get property "${name}" without inject`);
      },
    });
  }

  apply(ctx as never);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['am_echo', 'am_probe_tokens'],
  );
});
