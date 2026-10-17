import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import {
  findProfileEntry,
  loadProfile,
  ProfileError,
  queryProfile,
  renderProfileEntries,
  saveProfile,
  validateProfileEntries,
} from '../../src/profile/profile.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  return home;
}

test('S10.2 profile entries round-trip with § separators', (t) => {
  const home = fixture(t);
  assert.deepEqual(loadProfile(home).entries, []);
  const entries = ['用户希望被称为「why」。', '用户是南京大学的本科生。'];
  const saved = saveProfile(home, entries);
  assert.equal(saved.chars > 0, true);
  assert.deepEqual(loadProfile(home).entries, entries);
  assert.deepEqual(queryProfile(loadProfile(home).entries, '南京'), [entries[1]]);
  assert.equal(renderProfileEntries(entries).split('§').length, 2);
});

test('S10.2 profile rejects empty entries, embedded separators and overflow', () => {
  assert.match(validateProfileEntries(['', 'ok']).join(';'), /entry 1 is empty/);
  assert.match(validateProfileEntries(['第一行\n§\n第二行']).join(';'), /separator line/);
  assert.match(validateProfileEntries(['x'.repeat(10_001)]).join(';'), /10000/);
});

test('S10.2 findProfileEntry needs a unique literal match', (t) => {
  const home = fixture(t);
  saveProfile(home, ['alpha beta', 'alpha gamma']);
  const entries = loadProfile(home).entries;
  assert.equal(findProfileEntry(entries, 'beta'), 0);
  assert.throws(() => findProfileEntry(entries, 'alpha'), (error: unknown) => error instanceof ProfileError && error.code === 'CONFLICT');
  assert.throws(() => findProfileEntry(entries, 'missing'), (error: unknown) => error instanceof ProfileError && error.code === 'NOT_FOUND');
});

test('S10.2 comments in USER.md are stripped before parsing', (t) => {
  const home = fixture(t);
  writeFileSync(join(home, 'USER.md'), '<!-- comment -->\n用户偏好：中文。\n');
  assert.deepEqual(loadProfile(home).entries, ['用户偏好：中文。']);
});
