import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { initStore } from '../../src/init.ts';
import { loadConfig } from '../../src/config/load.ts';
import { MemoryStore } from '../../src/store/store.ts';
import { createProposal } from '../../src/proposals/proposals.ts';
import { saveProfile } from '../../src/profile/profile.ts';
import { runHumanCommand, type HumanCommandDeps, type HumanCommandResult } from '../../src/human/command.ts';
import { cleanupHome, tempHome } from '../helpers.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const home = tempHome();
  t.after(() => cleanupHome(home));
  initStore({ home });
  const config = loadConfig({ home }).config;
  const store = new MemoryStore({ home, config });
  const deps: HumanCommandDeps = { store, config, home };
  return { home, config, store, deps };
}

function run(deps: HumanCommandDeps, line: string): HumanCommandResult {
  return runHumanCommand(deps, line);
}

function addFact(store: MemoryStore, abstract: string): string {
  return store.add({ kind: 'fact', abstract, body: 'body', evidence_level: 'observed' }, { author: 'human' }).id;
}

test('S8.1 /mem help lists the human verbs', (t) => {
  const { deps } = fixture(t);
  const result = run(deps, 'help');
  assert.equal(result.ok, true);
  for (const verb of ['proposals', 'decide', 'add', 'read', 'recall', 'inspect', 'purge']) {
    assert.match(result.text, new RegExp(verb));
  }
});

test('S8.1 add/read/recall keep quoted text together', (t) => {
  const { deps } = fixture(t);
  const added = run(deps, 'add --kind fact --abstract "聊天框里写一条" --body "body with spaces"');
  assert.equal(added.ok, true, added.text);
  const id = /(mem-\d{8}-[0-9a-f]{8})/.exec(added.text)?.[1];
  assert.ok(id);
  const read = run(deps, `read ${id}`);
  assert.equal(read.ok, true);
  assert.match(read.text, /聊天框里写一条/);
  assert.match(read.text, /body with spaces/);
  const recalled = run(deps, 'recall 聊天框里写一条');
  assert.equal(recalled.ok, true);
  assert.match(recalled.text, new RegExp(id));
});

test('S8.1 proposals lists the replacement and the decide hint', (t) => {
  const { deps, store, config } = fixture(t);
  assert.equal(run(deps, 'proposals').text, '没有待审提案。');
  const id = addFact(store, 'old chat fact');
  const proposal = createProposal(
    { store, config },
    {
      op: 'supersede',
      targets: [id],
      base_hashes: [store.read(id).content_hash],
      replacements: [{ kind: 'fact', abstract: 'new chat fact', body: 'b', evidence_level: 'observed' }],
      reason: 'chat review',
    },
  );
  const listed = run(deps, 'proposals');
  assert.equal(listed.ok, true);
  assert.match(listed.text, new RegExp(proposal.id));
  assert.match(listed.text, /new chat fact/);
  assert.match(listed.text, new RegExp(`/mem decide ${proposal.id} accept`));
});

test('S8.1 decide accept applies the supersede and names the new record', (t) => {
  const { deps, store, config } = fixture(t);
  const id = addFact(store, 'old for chat');
  const proposal = createProposal(
    { store, config },
    {
      op: 'supersede',
      targets: [id],
      base_hashes: [store.read(id).content_hash],
      replacements: [{ kind: 'fact', abstract: 'new for chat', body: 'b', evidence_level: 'observed' }],
    },
  );
  const accepted = run(deps, `decide ${proposal.id} accept`);
  assert.equal(accepted.ok, true);
  assert.match(accepted.text, /已采纳/);
  assert.match(accepted.text, /新记录 m(em-\d{8}-[0-9a-f]{8})/);
  assert.deepEqual(store.active().map((doc) => doc.abstract), ['new for chat']);
  assert.equal(run(deps, 'proposals').text, '没有待审提案。');
});

test('S8.1 decide reject keeps the target and an unknown id is a plain error', (t) => {
  const { deps, store, config } = fixture(t);
  const id = addFact(store, 'keep chat');
  const proposal = createProposal(
    { store, config },
    {
      op: 'supersede',
      targets: [id],
      base_hashes: [store.read(id).content_hash],
      replacements: [{ kind: 'fact', abstract: 'rejected replacement', body: 'b', evidence_level: 'observed' }],
    },
  );
  assert.match(run(deps, `decide ${proposal.id} reject`).text, /已否决/);
  assert.equal(store.recall('keep chat').hits.length, 1);
  const missing = run(deps, 'decide prop-nope accept');
  assert.equal(missing.ok, false);
  assert.match(missing.text, /no pending proposal/);
});

test('S8.1 decide --batch applies every pending proposal', (t) => {
  const { deps, store, config } = fixture(t);
  const first = addFact(store, 'batch one');
  const second = addFact(store, 'batch two');
  for (const id of [first, second]) {
    createProposal(
      { store, config },
      {
        op: 'supersede',
        targets: [id],
        base_hashes: [store.read(id).content_hash],
        replacements: [{ kind: 'fact', abstract: `replacement of ${id}`, body: 'b', evidence_level: 'observed' }],
      },
    );
  }
  const batch = run(deps, 'decide --batch accept');
  assert.equal(batch.ok, true);
  assert.match(batch.text, /accepted 2\/2/);
});

test('S8.1 delete needs a reason and purge needs --accept', (t) => {
  const { deps, store } = fixture(t);
  const id = addFact(store, 'delete via chat');
  assert.equal(run(deps, `delete ${id}`).ok, false);
  assert.match(run(deps, `delete ${id}`).text, /--reason/);
  assert.equal(run(deps, `delete ${id} --reason "chat cleanup"`).ok, true);
  assert.equal(store.recall('delete via chat').hits.length, 0);

  const purged = addFact(store, 'purge via chat');
  const blocked = run(deps, `purge ${purged} --reason "chat purge"`);
  assert.equal(blocked.ok, false);
  assert.match(blocked.text, /--accept/);
  assert.equal(run(deps, `purge ${purged} --reason "chat purge" --accept`).ok, true);
});

test('S8.1 inspect and export run from the same plane', (t) => {
  const { deps, home, store } = fixture(t);
  addFact(store, 'inspect me');
  const inspected = run(deps, 'inspect');
  assert.equal(inspected.ok, true);
  assert.match(inspected.text, /active 1/);
  assert.match(inspected.text, /journal head #/);
  const out = join(home, '..', `chat-export-${process.pid}`);
  const exported = run(deps, `export "${out}"`);
  assert.equal(exported.ok, true);
  assert.ok(existsSync(join(out, 'SHA256SUMS')));
});

test('S10.5 /mem profile and inspect warn when USER.md exceeds the injection budget', (t) => {
  const { deps, home } = fixture(t);
  saveProfile(home, ['x'.repeat(deps.config.inject.user_max_chars + 50)]);
  const profiled = run(deps, 'profile');
  assert.equal(profiled.ok, true);
  assert.match(profiled.text, /超过注入上限/);
  const inspected = run(deps, 'inspect');
  assert.match(inspected.text, /⚠ USER\.md/);
});

test('S8.1 an unknown verb and a broken quote fail loudly', (t) => {
  const { deps } = fixture(t);
  const unknown = run(deps, 'frobnicate');
  assert.equal(unknown.ok, false);
  assert.match(unknown.text, /未知子命令 frobnicate/);
  const quote = run(deps, 'add --abstract "unterminated');
  assert.equal(quote.ok, false);
  assert.match(quote.text, /unterminated quote/);
});
