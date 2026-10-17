import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultPolicy, hashBytes, loadPolicy, parsePolicyText, POLICY_TEMPLATE, sealPolicy } from '../src/policy/policy.ts';
import { initStore } from '../src/init.ts';
import { cleanupHome, expectStartupError, tempHome } from './helpers.ts';

function initialisedHome(t: { after: (fn: () => void) => void }): string {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  return home;
}

test('init writes and seals policy.json', (t) => {
  const home = initialisedHome(t);
  const policyPath = join(home, 'policy.json');
  const sealPath = join(home, '.state', 'policy.seal.json');
  assert.ok(existsSync(policyPath));
  assert.ok(existsSync(sealPath));

  const sealed = JSON.parse(readFileSync(sealPath, 'utf8')) as { sha256: string; policy: string };
  assert.equal(sealed.sha256, hashBytes(readFileSync(policyPath)));
  assert.equal(sealed.policy, 'policy.json');

  const loaded = loadPolicy({ home });
  assert.equal(loaded.policy.version, 2);
  assert.equal(loaded.policy.scan.private_tag, 'confirm');
  assert.equal(loaded.sha256, sealed.sha256);
});

test('the default policy matches the template', (t) => {
  const home = initialisedHome(t);
  assert.deepEqual(loadPolicy({ home }).policy, defaultPolicy());
  assert.equal(JSON.stringify(defaultPolicy(), null, 2) + '\n', POLICY_TEMPLATE);
});

test('editing policy.json breaks startup until a human re-seals', (t) => {
  const home = initialisedHome(t);
  const policyPath = join(home, 'policy.json');
  const before = loadPolicy({ home }).sha256;
  writeFileSync(
    policyPath,
    readFileSync(policyPath, 'utf8').replace('"max_records": 1000', '"max_records": 100000'),
  );

  const error = expectStartupError(() => loadPolicy({ home }), 'POLICY_MISMATCH');
  assert.match(error.format(), /does not match its sealed hash/);
  assert.match(error.format(), new RegExp(before));
  assert.match(error.format(), /mem policy seal --accept/);

  const resealed = sealPolicy({ home, accept: true });
  assert.equal(resealed.previousSha256, before);
  assert.equal(loadPolicy({ home }).policy.capacity.max_records, 100000);
});

test('a whitespace-only edit is still a mismatch', (t) => {
  const home = initialisedHome(t);
  const policyPath = join(home, 'policy.json');
  writeFileSync(policyPath, `${readFileSync(policyPath, 'utf8')}\n`);
  expectStartupError(() => loadPolicy({ home }), 'POLICY_MISMATCH');
});

test('sealing without explicit confirmation is refused', (t) => {
  const home = initialisedHome(t);
  const error = expectStartupError(() => sealPolicy({ home, accept: false }), 'SEAL_REFUSED');
  assert.match(error.format(), /without explicit confirmation/);
});

test('a missing seal or a missing policy is a loud startup failure', (t) => {
  const home = initialisedHome(t);
  rmSync(join(home, '.state', 'policy.seal.json'));
  expectStartupError(() => loadPolicy({ home }), 'POLICY_MISSING');

  rmSync(join(home, 'policy.json'));
  expectStartupError(() => loadPolicy({ home }), 'POLICY_MISSING');
});

test('a corrupt seal file is rejected, not trusted', (t) => {
  const home = initialisedHome(t);
  writeFileSync(join(home, '.state', 'policy.seal.json'), '{ not json');
  expectStartupError(() => loadPolicy({ home }), 'POLICY_INVALID');

  writeFileSync(join(home, '.state', 'policy.seal.json'), JSON.stringify({ sha256: 'short' }));
  expectStartupError(() => loadPolicy({ home }), 'POLICY_INVALID');
});

test('a policy saved with a UTF-8 BOM still seals and loads', (t) => {
  const home = initialisedHome(t);
  const policyPath = join(home, 'policy.json');
  writeFileSync(policyPath, `\uFEFF${readFileSync(policyPath, 'utf8')}`);
  const seal = sealPolicy({ home, accept: true });
  assert.equal(loadPolicy({ home }).sha256, seal.sha256);
});

test('unknown policy keys are refused and named', () => {
  const text = POLICY_TEMPLATE.replace('"version": 2,', '"version": 2,\n  "skip_approval": true,');
  const { problems } = parsePolicyText(text);
  assert.deepEqual(
    problems.map((problem) => problem.key),
    ['skip_approval'],
  );
});

test('policy may not make RULES.md writable by the agent', () => {
  const text = POLICY_TEMPLATE.replace('"agent_writable": false', '"agent_writable": true');
  const { problems } = parsePolicyText(text);
  assert.deepEqual(
    problems.map((problem) => problem.key),
    ['rules.agent_writable'],
  );
});

test('invalid policy JSON is reported as a policy failure', () => {
  const { problems } = parsePolicyText('{ nope');
  assert.deepEqual(
    problems.map((problem) => problem.key),
    ['<json>'],
  );
});

test('a malformed policy cannot be sealed', (t) => {
  const home = initialisedHome(t);
  writeFileSync(join(home, 'policy.json'), '{ "version": 2, "approval": { "mode": "auto" } }');
  const error = expectStartupError(() => sealPolicy({ home, accept: true }), 'POLICY_INVALID');
  assert.ok(error.keys.includes('approval'));
});
