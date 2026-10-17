import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG_TEMPLATE,
  configKeys,
  defaultConfig,
  parseConfig,
  validateConfigTable,
  type Config,
} from '../src/config/config.ts';
import { ConfigError } from '../src/errors.ts';
import { expectConfigError } from './helpers.ts';

test('the generated template is exactly the schema defaults', () => {
  const parsed = parseConfig(CONFIG_TEMPLATE, 'config.toml');
  assert.deepEqual(parsed, defaultConfig());
});

test('the config surface covered by docs is stable', () => {
  const keys = configKeys();
  assert.equal(keys.length, 24);
  assert.ok(keys.includes('inject.persona_max_chars'));
  assert.ok(keys.includes('inject.guidance_max_chars'));
  assert.ok(keys.includes('personalization.mode'));
  assert.ok(keys.includes('storage.max_records'));
  assert.ok(!keys.includes('viewer.enabled'));
  assert.ok(!keys.includes('audit.enabled'));
});

test('an unknown key fails startup and is named', () => {
  const text = CONFIG_TEMPLATE.replace('persona_max_chars', 'persona_max_char');
  const error = expectConfigError(() => parseConfig(text, 'config.toml'));
  assert.ok(error instanceof ConfigError);
  assert.deepEqual(error.keys, ['inject.persona_max_char']);
  assert.match(error.format(), /inject\.persona_max_char/);
  assert.match(error.format(), /did you mean "inject\.persona_max_chars"/);
  assert.match(error.format(), /line 15/);
});

test('a wrong type names the key and what was found', () => {
  const text = CONFIG_TEMPLATE.replace('max_records = 1000', 'max_records = "many"');
  const error = expectConfigError(() => parseConfig(text, 'config.toml'));
  assert.deepEqual(error.keys, ['storage.max_records']);
  assert.match(error.format(), /must be an integer, not the string "many"/);
});

test('an out-of-range value names the key and the bound', () => {
  const text = CONFIG_TEMPLATE.replace('limit = 5', 'limit = 500');
  const error = expectConfigError(() => parseConfig(text, 'config.toml'));
  assert.deepEqual(error.keys, ['recall.limit']);
  assert.match(error.format(), /at most 100, found 500/);
});

test('the five injection sections may not exceed the total budget', () => {
  const text = CONFIG_TEMPLATE.replace('total_max_chars = 4000', 'total_max_chars = 1000');
  const error = expectConfigError(() => parseConfig(text, 'config.toml'));
  assert.deepEqual(error.keys, ['inject.total_max_chars']);
  assert.match(error.format(), /add up to 4000 chars/);
});

test('an unknown table is refused by name', () => {
  const error = expectConfigError(() =>
    parseConfig(`${CONFIG_TEMPLATE}\n[retrieval]\nlimit = 3\n`, 'config.toml'),
  );
  assert.deepEqual(error.keys, ['retrieval']);
  assert.match(error.format(), /unknown key "retrieval"/);
});

test('all problems are reported in one pass, sorted by key', () => {
  const text = CONFIG_TEMPLATE.replace('max_records = 1000', 'max_records = 0\nbogus = 1');
  const error = expectConfigError(() => parseConfig(text, 'config.toml'));
  assert.deepEqual(error.keys, ['storage.bogus', 'storage.max_records']);
  assert.deepEqual(
    [...error.keys].sort((a, b) => a.localeCompare(b)),
    error.keys,
  );
});

test('a customised but valid config is accepted', () => {
  const text = CONFIG_TEMPLATE.replace('max_records = 1000', 'max_records = 250').replace(
    'limit = 5',
    'limit = 3',
  );
  const config = parseConfig(text, 'config.toml');
  assert.equal(config.storage.max_records, 250);
  assert.equal(config.recall.limit, 3);
});

test('validateConfigTable accepts an empty table and fills defaults', () => {
  const { config, problems } = validateConfigTable({});
  assert.deepEqual(problems, []);
  const typed: Config = config;
  assert.equal(typed.inject.total_max_chars, 4000);
  assert.equal(typed.inject.protect, true);
  assert.equal(typed.distill.max_proposals, 5);
  assert.equal(typed.distill.require_quote, true);
});

test('config v1 keys removed in v2 are refused by name', () => {
  const withAudit = expectConfigError(() =>
    parseConfig(`${CONFIG_TEMPLATE}\n[audit]\nenabled = true\n`, 'config.toml'),
  );
  assert.deepEqual(withAudit.keys, ['audit']);

  const withViewer = expectConfigError(() =>
    parseConfig(`${CONFIG_TEMPLATE}\n[viewer]\nenabled = false\n`, 'config.toml'),
  );
  assert.deepEqual(withViewer.keys, ['viewer']);
});

test('syntax errors are reported as config failures, not crashes', () => {
  const error = expectConfigError(() => parseConfig('limit = 1.5', 'config.toml'));
  assert.deepEqual(error.keys, ['<syntax>']);
  assert.match(error.format(), /floats are not supported/);
});
