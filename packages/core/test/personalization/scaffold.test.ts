import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { loadPolicy, sealPolicy } from '../../src/policy/policy.ts';
import { scaffoldPersonalization, SOUL_TEMPLATE } from '../../src/personalization/scaffold.ts';
import { assemble } from '../../src/inject/assemble.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { startup } from '../../src/startup.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  return { home };
}

function assembleAt(home: string, sessionId: string) {
  const config = loadConfig({ home }).config;
  const policy = loadPolicy({ home }).policy;
  const store = new MemoryStore({ home, config });
  return assemble({ home, config, policy, source: store, sessionId, persist: false });
}

test('S10.1 scaffold creates comment-only human files and seals soul/rules only', (t) => {
  const { home } = fixture(t);
  const result = scaffoldPersonalization({ home });
  assert.equal(result.created.length, 3);
  assert.equal(readFileSync(join(home, 'SOUL.md'), 'utf8'), SOUL_TEMPLATE);
  assert.notEqual(result.sealedFiles.soul, '');
  assert.equal(result.sealedFiles.user, '');
  assert.notEqual(result.sealedFiles.rules, '');

  const second = scaffoldPersonalization({ home });
  assert.equal(second.created.length, 0);
  assert.equal(second.kept.length, 3);
});

test('S10.1 untouched templates inject nothing; edited SOUL needs a reseal', (t) => {
  const { home } = fixture(t);
  scaffoldPersonalization({ home });
  const empty = assembleAt(home, 's-empty');
  assert.equal(empty.parts.SOUL, '');
  assert.equal(empty.parts.USER, '');
  assert.equal(empty.parts.RULES, '');

  writeFileSync(join(home, 'SOUL.md'), '人格：测试角色\n');
  assert.throws(() => startup({ home }), /SOUL\.md/);
  sealPolicy({ home, accept: true });
  assert.doesNotThrow(() => startup({ home }));
  const filled = assembleAt(home, 's-filled');
  assert.equal(filled.parts.SOUL, '人格：测试角色');

  // USER is unsealed by default: editing it must not block startup.
  writeFileSync(join(home, 'USER.md'), '用户偏好：简短回答\n');
  assert.doesNotThrow(() => startup({ home }));
  const user = assembleAt(home, 's-user');
  assert.equal(user.parts.USER, '用户偏好：简短回答');
});
