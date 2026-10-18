import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..', '..');

test('S17.3 the retro skill is a valid catalog entry with the three commands', () => {
  const skill = readFileSync(join(root, '.dsh', 'skills', 'agent-memory-retro', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: agent-memory-retro\n/m);
  assert.match(skill, /description: /);
  assert.match(skill, /memory_propose/);
  assert.match(skill, /event_seq/);

  const plugin = readFileSync(join(root, 'packages', 'dsh', 'src', 'plugin.ts'), 'utf8');
  assert.match(plugin, /name: `mem-\$\{kind\}`/);
  for (const kind of ['fact', 'pitfall', 'exp']) {
    assert.match(plugin, new RegExp(`registerRetro\\('${kind}'`));
  }
});

test('S17.4 the human command help lists the three review commands', () => {
  const command = readFileSync(join(root, 'packages', 'core', 'src', 'human', 'command.ts'), 'utf8');
  assert.match(command, /\/mem-fact/);
  assert.match(command, /\/mem-pitfall/);
  assert.match(command, /\/mem-exp/);
});
