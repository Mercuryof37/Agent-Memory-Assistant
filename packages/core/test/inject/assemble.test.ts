import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { loadPolicy, sealPolicy, type Policy } from '../../src/policy/policy.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { assemble } from '../../src/inject/assemble.ts';
import { snapshotPath, writeSnapshot, PROMPT_SCHEMA_VERSION } from '../../src/inject/snapshot.ts';
import { StartupError } from '../../src/errors.ts';
import type { MemoryDoc } from '../../src/model/types.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

function fixture(t: { after: (fn: () => void) => void }): { home: string; config: ReturnType<typeof loadConfig>['config']; policy: Policy } {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  return { home, config: loadConfig({ home }).config, policy: loadPolicy({ home }).policy };
}

function doc(id: string, abstract: string, overrides: Partial<MemoryDoc> = {}): MemoryDoc {
  return {
    id,
    mem_schema: 1,
    kind: 'fact',
    scope: 'local',
    abstract,
    created_at: '2026-10-17T00:00:00+00:00',
    valid_from: '2026-10-17',
    valid_until: null,
    supersedes: [],
    author: 'human',
    evidence_level: 'user_explicit',
    error_signatures: [],
    provenance: [],
    body: `${abstract} body`,
    file_path: `${id}.md`,
    content_hash: 'a'.repeat(64),
    ...overrides,
  };
}

function source(docs: MemoryDoc[], audits: unknown[] = []) {
  return {
    active: () => docs,
    journal: { append: (entry: unknown) => audits.push(entry) },
  };
}

test('S9.2 snapshot capture goes through the store audit sink and keeps the manifest in sync', (t) => {
  const { home, config, policy } = fixture(t);
  const store = new MemoryStore({ home, config });
  assemble({ home, config, policy, source: store, sessionId: 'session-a' });
  // A snapshot audit must not look like a truncated journal on the next write.
  const written = store.add(
    { kind: 'fact', abstract: 'after snapshot', body: 'b', evidence_level: 'observed' },
    { author: 'human' },
  );
  assert.match(written.id, /^mem-/);
  const reopened = new MemoryStore({ home, config });
  assert.deepEqual(reopened.diagnostics().issues, []);
});

test('S3.3 fenced code and </memory> cannot escape the delimiter block', (t) => {
  const { home, config, policy } = fixture(t);
  const delimiter = 'deadbeefdeadbeef';
  const tricky = doc('mem-20261017-00000001', '正文含 ``` 与 </memory> 以及分隔符 deadbeefdeadbeef');
  const result = assemble({
    home,
    config,
    policy,
    source: source([tricky]),
    sessionId: 's1',
    delimiter,
    persist: false,
  });
  assert.equal(result.text.split(delimiter).length - 1, 2);
  assert.ok(result.text.includes('<escaped>'));
  assert.ok(result.text.indexOf('```') > result.text.indexOf(`<<AM-${delimiter}>>`));
});

test('S3.4 same session is byte-identical, a new session sees a new revision', (t) => {
  const { home, config } = fixture(t);
  writeFileSync(join(home, 'SOUL.md'), 'calm and precise\n');
  sealPolicy({ home, accept: true });
  const sealed = loadPolicy({ home }).policy;
  const first = doc('mem-20261017-00000001', 'alpha fact');
  const sourceDocs = [first];

  const one = assemble({ home, config, policy: sealed, source: source(sourceDocs), sessionId: 'session-a' });
  const two = assemble({ home, config, policy: sealed, source: source(sourceDocs), sessionId: 'session-a' });
  assert.equal(one.text, two.text);
  assert.equal(two.captured, false);

  sourceDocs.push(doc('mem-20261017-00000002', 'beta fact'));
  const three = assemble({ home, config, policy: sealed, source: source(sourceDocs), sessionId: 'session-a' });
  assert.equal(three.text, one.text, 'same session stays frozen');

  const fresh = assemble({ home, config, policy: sealed, source: source(sourceDocs), sessionId: 'session-b' });
  assert.ok(fresh.text.includes('beta fact'));
  assert.notEqual(fresh.text, one.text);
  assert.notEqual(fresh.memory_revision, one.memory_revision);
});

test('S3.4 a missing snapshot is recaptured and audited', (t) => {
  const { home, config, policy } = fixture(t);
  const audits: unknown[] = [];
  const src = source([doc('mem-20261017-00000001', 'alpha')], audits);
  assemble({ home, config, policy, source: src, sessionId: 'session-restart' });
  rmSync(snapshotPath(home, 'session-restart'), { force: true });

  const again = assemble({ home, config, policy, source: src, sessionId: 'session-restart' });
  assert.equal(again.captured, true);
  assert.ok(audits.some((entry) => JSON.stringify(entry).includes('snapshot-capture')));
});

test('S3.4 snapshots keep only the newest 20', (t) => {
  const { home } = fixture(t);
  for (let index = 0; index < 21; index += 1) {
    writeSnapshot(home, {
      session_id: `session-${index}`,
      memory_revision: 'rev',
      prompt_schema_version: PROMPT_SCHEMA_VERSION,
      created_at: new Date(2026, 0, 1, 0, index).toISOString(),
      text: `text ${index}`,
    });
  }
  const files = readdirSync(join(home, '.state', 'snapshots')).filter((name) => name.endsWith('.json'));
  assert.equal(files.length, 20);
});

test('S13.3 rules over budget degrade only the rules section', (t) => {
  const { home, config, policy } = fixture(t);
  writeFileSync(join(home, 'SOUL.md'), '人格：仍然可用\n');
  sealPolicy({ home, accept: true });
  writeFileSync(join(home, 'RULES.md'), `1. [模型指引] ${'长'.repeat(config.inject.rules_max_chars + 100)}\n`);
  const result = assemble({ home, config, policy, source: source([]), sessionId: 's1', persist: false });
  const rulesHealth = result.health.find((entry) => entry.key === 'RULES');
  assert.equal(rulesHealth?.ok, false);
  assert.match(result.parts.RULES ?? '', /本节不可用（RULES）/);
  // The other sections keep rendering: SOUL is still there and the body has no
  // hard-fail; only the RULES block was replaced by the notice.
  assert.match(result.parts.SOUL ?? '', /人格：仍然可用/);
  assert.ok(result.sectionList.some((section) => section.key === 'RULES'));
});

test('S3.5 empty sections produce no empty headings', (t) => {
  const { home, config, policy } = fixture(t);
  const result = assemble({ home, config, policy, source: source([]), sessionId: 's1', delimiter: 'abc', persist: false });
  assert.doesNotMatch(result.text, /## SOUL|## USER|## RULES|## MEMORY/);
});

test('S3.5 200 memories stay within the injection budget', (t) => {
  const { home, config, policy } = fixture(t);
  const docs = Array.from({ length: 200 }, (_, index) =>
    doc(`mem-20261017-${String(index).padStart(8, '0')}`, `记忆条目 ${index} 的摘要内容`),
  );
  const result = assemble({ home, config, policy, source: source(docs), sessionId: 's1', persist: false });
  assert.ok([...result.text].length <= config.inject.total_max_chars + 80);
  assert.match(result.text, /未列出/);
});

test('T2 an edited sealed file is rejected at injection time', (t) => {
  const { home, config } = fixture(t);
  const soul = join(home, 'SOUL.md');
  writeFileSync(soul, 'original persona\n');
  sealPolicy({ home, accept: true });
  const sealed = loadPolicy({ home }).policy;
  assert.doesNotThrow(() =>
    assemble({ home, config, policy: sealed, source: source([]), sessionId: 's1', persist: false }),
  );

  writeFileSync(soul, 'edited persona\n');
  assert.throws(
    () => assemble({ home, config, policy: sealed, source: source([]), sessionId: 's1', persist: false }),
    (error: unknown) => error instanceof StartupError && error.code === 'SEALED_FILE_MISMATCH',
  );
});

test('S11.3 the guidance section follows personalization.mode and stays in budget', (t) => {
  const { home } = fixture(t);
  const config = loadConfig({ home }).config;
  const policy = loadPolicy({ home }).policy;
  const store = new MemoryStore({ home, config });
  const assembleWith = (mode: 'confirm' | 'direct' | 'readonly', sessionId: string) =>
    assemble({
      home,
      config: { ...config, personalization: { mode } },
      policy,
      source: store,
      sessionId,
      persist: false,
    });

  const confirm = assembleWith('confirm', 'g1');
  assert.match(confirm.parts.GUIDANCE ?? '', /记忆与方法复用/);
  assert.match(confirm.parts.GUIDANCE ?? '', /确认卡片/);
  assert.ok([...(confirm.parts.GUIDANCE ?? '')].length <= config.inject.guidance_max_chars);

  assert.match(assembleWith('direct', 'g2').parts.GUIDANCE ?? '', /直接写入/);
  assert.match(assembleWith('readonly', 'g3').parts.GUIDANCE ?? '', /只读/);
});

test('S13.4 an extra document layer plugs into the section registry', (t) => {
  const { home, config, policy } = fixture(t);
  writeFileSync(join(home, 'RULES.md'), '1. [模型指引] 测试规则\n');
  const result = assemble({
    home,
    config,
    policy,
    source: source([]),
    sessionId: 'extra-doc',
    persist: false,
    extraSections: [
      { key: 'PRINCIPLES', order: 120, load: () => '原则：先读后写，再改。' },
    ],
  });
  assert.match(result.parts.PRINCIPLES ?? '', /先读后写/);
  assert.ok(result.health.some((entry) => entry.key === 'PRINCIPLES' && entry.ok));
  const keys = result.sectionList.map((section) => section.key);
  assert.ok(keys.indexOf('PRINCIPLES') > keys.indexOf('GUIDANCE'));
  assert.ok(keys.indexOf('PRINCIPLES') < keys.indexOf('RULES'));
});

test('T3 a deleted memory never reaches the assembled text', (t) => {
  const { home } = fixture(t);
  const config = loadConfig({ home }).config;
  const policy = loadPolicy({ home }).policy;
  const store = new MemoryStore({ home, config });
  const written = store.add(
    { kind: 'fact', abstract: 'deleted but memorable', body: 'gone', evidence_level: 'observed' },
    { author: 'human' },
  );
  store.remove(written.id, { reason: 'test' });
  const result = assemble({ home, config, policy, source: store, sessionId: 's1', persist: false });
  assert.doesNotMatch(result.text, /deleted but memorable/);
});
