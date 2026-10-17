import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRestrictedToml, TomlSyntaxError, type RawTable } from '../src/config/toml.ts';

function table(value: unknown): RawTable {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), 'expected a table');
  return value as RawTable;
}

function syntaxError(text: string): TomlSyntaxError {
  try {
    parseRestrictedToml(text, { sourcePath: 'config.toml' });
  } catch (error) {
    if (error instanceof TomlSyntaxError) return error;
    throw error;
  }
  assert.fail(`expected a TomlSyntaxError for: ${text}`);
}

test('parses the supported subset and records line numbers', () => {
  const doc = parseRestrictedToml(
    [
      '# leading comment',
      'schema_version = 1',
      '',
      '[storage]',
      'max_records = 1000   # trailing comment',
      'enabled = true',
      'tags = ["a", "b"]',
      'quoted = "hash # inside"',
      "literal = 'raw \\ text'",
      '',
      '[inject]',
      'nested = false',
      '',
      '[inject.deep]',
      'value = "x"',
    ].join('\n'),
  );

  assert.equal(doc.root.schema_version, 1);

  const storage = table(doc.root.storage);
  assert.equal(storage.max_records, 1000);
  assert.equal(storage.enabled, true);
  assert.deepEqual(storage.tags, ['a', 'b']);
  assert.equal(storage.quoted, 'hash # inside');
  assert.equal(storage.literal, 'raw \\ text');

  const inject = table(doc.root.inject);
  assert.equal(inject.nested, false);
  assert.equal(table(inject.deep).value, 'x');

  assert.equal(doc.lineOf('storage.max_records'), 5);
  assert.equal(doc.lineOf('inject.deep.value'), 15);
  assert.equal(doc.lineOf('missing.key'), undefined);
});

test('handles CRLF, blank files and literal strings', () => {
  assert.deepEqual(parseRestrictedToml('').root, {});
  const doc = parseRestrictedToml('a = 1\r\nb = "two"\r\n');
  assert.equal(doc.root.a, 1);
  assert.equal(doc.root.b, 'two');
});

test('decodes escapes in basic strings', () => {
  const doc = parseRestrictedToml('a = "line\\nnext\\tindent\\"quote\\""');
  assert.equal(doc.root.a, 'line\nnext\tindent"quote"');
});

test('rejects duplicate keys and duplicate tables', () => {
  assert.match(syntaxError('a = 1\na = 2').message, /duplicate key "a"/);
  assert.match(syntaxError('[a]\nx = 1\n[a]\ny = 2').message, /duplicate table \[a\]/);
  assert.match(syntaxError('[a]\nx = 1\nx = 2').message, /duplicate key "a\.x"/);
});

test('rejects values outside the subset with a line number', () => {
  assert.match(syntaxError('a = 1.5').message, /floats are not supported/);
  assert.match(syntaxError('a = { b = 1 }').message, /inline tables are not supported/);
  assert.match(syntaxError('a = """x"""').message, /multi-line strings are not supported/);
  assert.match(syntaxError('a = 2026-10-17').message, /unsupported value/);
  assert.match(syntaxError('a = "unterminated').message, /unterminated string/);
  assert.match(syntaxError('a = [1, "two"]').message, /single type/);
  assert.match(syntaxError('a = [[1]]').message, /nested arrays/);
  assert.match(syntaxError('a = "x"\n[[table]]').message, /arrays of tables/);

  const error = syntaxError('ok = 1\n\nbad = 1.5');
  assert.equal(error.line, 3);
  assert.match(error.message, /config\.toml:3/);
});

test('rejects keys and headers outside the subset', () => {
  assert.match(syntaxError('a.b = 1').message, /dotted keys are not supported/);
  assert.match(syntaxError('bad key = 1').message, /invalid key/);
  assert.match(syntaxError('= 1').message, /missing key/);
  assert.match(syntaxError('a =').message, /missing value/);
  assert.match(syntaxError('[inject').message, /malformed table header/);
});

test('handles a UTF-8 BOM from Windows editors', () => {
  const doc = parseRestrictedToml('\uFEFFa = 1\n');
  assert.equal(doc.root.a, 1);
});

test('rejects a table that collides with a scalar', () => {
  assert.match(syntaxError('a = 1\n[a]\nb = 2').message, /conflicts with an existing value/);
});

test('quoted keys are supported', () => {
  const doc = parseRestrictedToml('"quoted-key" = 1');
  assert.equal(doc.root['quoted-key'], 1);
});
