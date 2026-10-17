import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../src/main.ts';
import { cleanupHome, tempHome } from '../../core/test/helpers.ts';

interface Captured {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function mem(argv: string[], env: Record<string, string | undefined> = {}): Promise<Captured> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    env,
    cwd: process.cwd(),
  });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

function homeFor(t: { after: (fn: () => void) => void }): string {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  return home;
}

test('init creates the store and doctor verifies it', async (t) => {
  const home = homeFor(t);

  const init = await mem(['init', '--home', home]);
  assert.equal(init.code, 0);
  assert.match(init.stdout, /created directories: \d+/);
  assert.ok(existsSync(join(home, 'config.toml')));
  assert.ok(existsSync(join(home, 'policy.json')));
  assert.ok(existsSync(join(home, '.state', 'policy.seal.json')));
  assert.ok(existsSync(join(home, 'memories', 'fact')));
  assert.ok(existsSync(join(home, 'proposals', 'pending')));

  const doctor = await mem(['doctor', '--home', home]);
  assert.equal(doctor.code, 0);
  assert.match(doctor.stdout, /store check/);
  assert.match(doctor.stdout, /4000 chars total/);
});

test('init is idempotent and never overwrites human edits', async (t) => {
  const home = homeFor(t);
  await mem(['init', '--home', home]);

  const configPath = join(home, 'config.toml');
  writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}\n# edited by hand\n`);

  const second = await mem(['init', '--home', home]);
  assert.equal(second.code, 0);
  assert.match(second.stdout, /kept as-is: config\.toml/);
  assert.match(readFileSync(configPath, 'utf8'), /edited by hand/);
});

test('doctor on an uninitialised store exits 2 and says what to do', async (t) => {
  const home = join(homeFor(t), 'does-not-exist');
  const result = await mem(['doctor', '--home', home]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /HOME_INVALID/);
  assert.match(result.stderr, /mem init/);
});

test('an unknown config key exits 2 and names the key and line', async (t) => {
  const home = homeFor(t);
  await mem(['init', '--home', home]);
  const configPath = join(home, 'config.toml');
  writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('limit = 5', 'limits = 8'));

  const result = await mem(['doctor', '--home', home]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /CONFIG_INVALID/);
  assert.match(result.stderr, /recall\.limits/);
  assert.match(result.stderr, /line \d+/);
});

test('a tampered policy exits 2 and reports both hashes', async (t) => {
  const home = homeFor(t);
  await mem(['init', '--home', home]);
  const policyPath = join(home, 'policy.json');
  const before = readFileSync(policyPath, 'utf8');
  writeFileSync(policyPath, before.replace('"private_tag": "confirm"', '"private_tag": "reject"'));

  const result = await mem(['doctor', '--home', home]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /POLICY_MISMATCH/);
  assert.match(result.stderr, /sealed sha256/);
  assert.match(result.stderr, /actual sha256/);
});

test('policy seal refuses to run without --accept, then succeeds with it', async (t) => {
  const home = homeFor(t);
  await mem(['init', '--home', home]);
  const policyPath = join(home, 'policy.json');
  writeFileSync(policyPath, readFileSync(policyPath, 'utf8').replace('"max_records": 1000', '"max_records": 2000'));

  const refused = await mem(['policy', 'seal', '--home', home]);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, /SEAL_REFUSED/);

  const sealed = await mem(['policy', 'seal', '--home', home, '--accept']);
  assert.equal(sealed.code, 0);
  assert.match(sealed.stdout, /policy sealed/);
  assert.match(sealed.stdout, /previous: /);

  const doctor = await mem(['doctor', '--home', home]);
  assert.equal(doctor.code, 0);
});

test('doctor --json is machine readable', async (t) => {
  const home = homeFor(t);
  await mem(['init', '--home', home]);
  const result = await mem(['doctor', '--home', home, '--json']);
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.stdout) as { home: string; limits: { max_records: number } };
  assert.equal(parsed.home, home);
  assert.equal(parsed.limits.max_records, 1000);
});

test('usage errors exit 1 and print the usage text', async () => {
  const unknown = await mem(['nope']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /unknown command "nope"/);
  assert.match(unknown.stderr, /Usage:/);

  const badFlag = await mem(['doctor', '--nope']);
  assert.equal(badFlag.code, 1);
  assert.match(badFlag.stderr, /unknown flag --nope/);

  const help = await mem(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /mem - Agent Memory V1\.0/);
});

test('a missing explicit config exits 2', async (t) => {
  const home = homeFor(t);
  await mem(['init', '--home', home]);
  const result = await mem(['doctor', '--home', home, '--config', join(home, 'missing.toml')]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /CONFIG_UNREADABLE/);
});
