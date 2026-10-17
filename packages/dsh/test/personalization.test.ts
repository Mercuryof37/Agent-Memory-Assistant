import test from 'node:test';
import assert from 'node:assert/strict';
import { initStore } from '../../core/src/index.ts';
import { loadProfile, saveProfile } from '../../core/src/index.ts';
import { cleanupHome, tempHome } from '../../core/test/helpers.ts';
import { executeUserProfile, type ProfileToolDeps } from '../src/personalization.ts';

function fixture(
  t: { after: (fn: () => void) => void },
  answer: string | undefined,
  mode: 'confirm' | 'direct' | 'readonly' = 'confirm',
) {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  saveProfile(home, ['用户希望被称为「why」。']);
  const audits: unknown[] = [];
  const requests: unknown[] = [];
  const deps: ProfileToolDeps = {
    home,
    mode,
    store: {
      appendAudit: (data: Record<string, unknown>) => {
        audits.push(data);
      },
    } as never,
    resolveQuestions: () => ({
      ask: async (request: unknown) => {
        requests.push(request);
        return { answers: [{ id: 'user_profile', selected: answer === undefined ? [] : [answer] }] };
      },
    }),
    readSessions: new Set<string>(),
  };
  return { home, deps, audits, requests };
}

const exec = { agent: { session: { id: 's1' } }, callId: 'call-1' };

test('S10.3 user_profile reads, and writes need a prior read', async (t) => {
  const { deps } = fixture(t, '确认');
  // Write before read is refused.
  await assert.rejects(
    async () => executeUserProfile(deps, { op: 'add', content: '用户是本科生。' }, exec),
    /先读取 USER\.md/,
  );
  const read = (await executeUserProfile(deps, { op: 'read' }, exec)) as { entries: string[] };
  assert.deepEqual(read.entries, ['用户希望被称为「why」。']);

  const added = (await executeUserProfile(deps, { op: 'add', content: '用户是本科生。' }, exec)) as {
    ok: boolean;
    entries: string[];
  };
  assert.equal(added.ok, true);
  assert.deepEqual(added.entries, ['用户希望被称为「why」。', '用户是本科生。']);
});

test('S10.3 the card shows the change and a cancel leaves the file alone', async (t) => {
  const { home, deps, requests } = fixture(t, '取消');
  await executeUserProfile(deps, { op: 'read' }, exec);
  const result = (await executeUserProfile(deps, { op: 'remove', old_text: 'why' }, exec)) as {
    ok: boolean;
    cancelled?: boolean;
  };
  assert.equal(result.cancelled, true);
  assert.deepEqual(loadProfile(home).entries, ['用户希望被称为「why」。']);
  const request = requests[0] as { questions: Array<{ header: string; options: Array<{ label: string }> }> };
  assert.equal(request.questions[0]?.header, '用户偏好更新');
  assert.deepEqual(request.questions[0]?.options.map((option) => option.label), ['确认', '取消']);
});

test('S11.2 readonly blocks profile writes; direct writes without a card', async (t) => {
  const readonly = fixture(t, '确认', 'readonly');
  await executeUserProfile(readonly.deps, { op: 'read' }, exec);
  await assert.rejects(
    async () => executeUserProfile(readonly.deps, { op: 'add', content: '用户是本科生。' }, exec),
    /readonly/,
  );

  const direct = fixture(t, '确认', 'direct');
  await executeUserProfile(direct.deps, { op: 'read' }, exec);
  const added = (await executeUserProfile(direct.deps, { op: 'add', content: '用户是本科生。' }, exec)) as {
    ok: boolean;
  };
  assert.equal(added.ok, true);
  assert.equal(direct.requests.length, 0);
});

test('S10.3 replace and remove rewrite the file and append an audit line', async (t) => {
  const { home, deps, audits } = fixture(t, '确认');
  await executeUserProfile(deps, { op: 'read' }, exec);
  const replaced = (await executeUserProfile(
    deps,
    { op: 'replace', old_text: 'why', content: '用户希望被称为「wyh」。' },
    exec,
  )) as { entries: string[] };
  assert.deepEqual(replaced.entries, ['用户希望被称为「wyh」。']);
  assert.deepEqual(loadProfile(home).entries, ['用户希望被称为「wyh」。']);

  const removed = (await executeUserProfile(deps, { op: 'remove', old_text: 'wyh' }, exec)) as {
    entries: string[];
  };
  assert.deepEqual(removed.entries, []);
  assert.equal(audits.length, 2);
  assert.equal((audits[0] as { event: string }).event, 'user-profile');
});
