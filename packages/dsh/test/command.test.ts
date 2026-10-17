import test from 'node:test';
import assert from 'node:assert/strict';
import { initStore } from '../../core/src/index.ts';
import { cleanupHome, tempHome } from '../../core/test/helpers.ts';
import { apply } from '../src/plugin.ts';

interface RegisteredCommand {
  readonly name: string;
  readonly description: string;
  readonly input?: { readonly hint: string };
  readonly handler: (invocation: { rawInput?: string }) => unknown;
}

test('S8.1 the real plugin registers /mem outside the tool table and it works', async (t) => {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  process.env.AGENT_MEMORY_HOME = home;

  const commands: RegisteredCommand[] = [];
  const tools: Array<{ name?: string }> = [];
  const ctx = {
    tools: {
      register(definition: unknown) {
        tools.push(definition as { name?: string });
        return () => {};
      },
    },
    systemPrompt: { section: () => () => {} },
    commands: {
      register(spec: RegisteredCommand) {
        commands.push(spec);
        return () => {};
      },
    },
  };
  apply(ctx as never);

  const mem = commands.find((command) => command.name === 'mem');
  assert.ok(mem, '/mem must be registered when the store is available');
  assert.match(mem.input?.hint ?? '', /decide/);
  assert.ok(!tools.some((tool) => tool.name === 'decide'), 'decide must never be a tool');
  for (const name of ['user_profile', 'session_search', 'session_event_search', 'session_event_read', 'session_event_trace', 'session_trace']) {
    assert.ok(tools.some((tool) => tool.name === name), `${name} must be registered by the plugin`);
  }

  const added = (await mem.handler({
    rawInput: ' add --kind fact --abstract "from chat" --body "body text"',
  })) as { kind: string; text: string };
  assert.equal(added.kind, 'success', added.text);
  const id = /(mem-\d{8}-[0-9a-f]{8})/.exec(added.text)?.[1];
  assert.ok(id);

  const read = (await mem.handler({ rawInput: ` read ${id}` })) as { kind: string; text: string };
  assert.equal(read.kind, 'success');
  assert.match(read.text, /from chat/);
  assert.match(read.text, /body text/);

  const proposals = (await mem.handler({ rawInput: ' proposals' })) as { kind: string; text: string };
  assert.match(proposals.text, /没有待审提案/);
});
