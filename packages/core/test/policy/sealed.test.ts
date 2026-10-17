import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import { hashContent } from '../../src/model/frontmatter.ts';
import {
  computeSealedFiles,
  loadPolicy,
  parsePolicyText,
  POLICY_TEMPLATE,
  sealPolicy,
} from '../../src/policy/policy.ts';
import { startup } from '../../src/startup.ts';
import { cleanupHome, expectStartupError, tempHome } from '../helpers.ts';

function home(t: { after: (fn: () => void) => void }): string {
  const dir = tempHome();
  t.after(() => cleanupHome(dir));
  initStore({ home: dir });
  return dir;
}

test('sealing records soul and rules; USER stays unsealed unless asked', (t) => {
  const dir = home(t);
  writeFileSync(join(dir, 'SOUL.md'), 'persona line\n');
  writeFileSync(join(dir, 'USER.md'), 'user preference\n');
  writeFileSync(join(dir, 'RULES.md'), '# rules\n');

  const seal = sealPolicy({ home: dir, accept: true });
  const soulHash = hashContent(readFileSync(join(dir, 'SOUL.md'), 'utf8'));
  assert.equal(seal.sealedFiles.soul, soulHash);
  assert.equal(seal.sealedFiles.user, '');
  assert.notEqual(seal.sealedFiles.rules, '');

  const withUser = sealPolicy({ home: dir, accept: true, sealUser: true });
  assert.equal(withUser.sealedFiles.user, hashContent(readFileSync(join(dir, 'USER.md'), 'utf8')));

  const loaded = loadPolicy({ home: dir });
  assert.equal(loaded.policy.sealed_files.soul, soulHash);
  assert.equal(computeSealedFiles(dir).soul, soulHash);
});

test('a modified human file stops startup and names the file', (t) => {
  const dir = home(t);
  const soul = join(dir, 'SOUL.md');
  writeFileSync(soul, 'original persona\n');
  sealPolicy({ home: dir, accept: true });
  assert.doesNotThrow(() => startup({ home: dir }));

  writeFileSync(soul, 'edited persona\n');
  const error = expectStartupError(() => startup({ home: dir }), 'SEALED_FILE_MISMATCH');
  const text = error.format();
  assert.match(text, /SOUL\.md/);
  assert.match(text, /sealed hash/);
  // The repair command is printed highlighted so the user cannot miss it.
  assert.match(text, />>> RUN THIS COMMAND:/);
  assert.match(text, /mem policy seal --home /);
  assert.match(text, /--accept/);
  assert.match(text, /\/mem seal --accept/);
});

test('a sealed file that disappears also stops startup', (t) => {
  const dir = home(t);
  writeFileSync(join(dir, 'RULES.md'), '# rules\n');
  sealPolicy({ home: dir, accept: true });
  writeFileSync(join(dir, 'RULES.md'), '# changed\n');
  assert.throws(() => startup({ home: dir }), /RULES\.md/);
});

test('empty sealed hashes skip the check', (t) => {
  const dir = home(t);
  writeFileSync(join(dir, 'SOUL.md'), 'free-form\n');
  assert.doesNotThrow(() => startup({ home: dir }));
  const loaded = loadPolicy({ home: dir });
  assert.deepEqual(loaded.policy.sealed_files, { soul: '', user: '', rules: '' });
});

test('a malformed sealed hash is a policy problem', () => {
  const text = POLICY_TEMPLATE.replace('"soul": ""', '"soul": "not-a-hash"');
  const { problems } = parsePolicyText(text);
  assert.ok(problems.some((problem) => problem.key === 'sealed_files.soul'));
});
