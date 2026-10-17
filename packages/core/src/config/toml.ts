/**
 * A deliberately small TOML subset.
 *
 * ADR-0001 explains why this is hand-written instead of a dependency: runtime
 * dependencies are zero, and a half-understood config file is worse than a
 * rejected one. Supported syntax is exactly:
 *
 *   - comments (`#` to end of line, outside strings)
 *   - `[table]` and `[nested.table]` headers
 *   - `key = value` with bare keys ([A-Za-z0-9_-]+)
 *   - basic strings ("..." with \\ \" \n \r \t), literal strings ('...')
 *   - integers (decimal, optional sign) and booleans
 *   - single-line, homogeneous arrays of those scalars
 *
 * Anything else - floats, dates, inline tables, dotted keys, multi-line
 * strings, nested arrays, arrays of tables - is refused with a line number.
 */

export type RawScalar = string | number | boolean;
export type RawValue = RawScalar | readonly RawScalar[];
export interface RawTable {
  readonly [key: string]: RawValue | RawTable;
}

export interface TomlDocument {
  readonly root: RawTable;
  readonly lineOf: (key: string) => number | undefined;
}

export class TomlSyntaxError extends Error {
  readonly line: number;
  readonly sourcePath: string | undefined;

  constructor(message: string, line: number, sourcePath?: string) {
    super(sourcePath === undefined ? `line ${line}: ${message}` : `${sourcePath}:${line}: ${message}`);
    this.name = 'TomlSyntaxError';
    this.line = line;
    this.sourcePath = sourcePath;
  }
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/;
const INTEGER = /^[+-]?\d+$/;
const FLOAT = /^[+-]?(?:\d+\.\d*|\.\d+|\d+[eE][+-]?\d+|\d+\.\d*[eE][+-]?\d+)$/;
const ESCAPES: Readonly<Record<string, string>> = {
  '\\': '\\',
  '"': '"',
  n: '\n',
  r: '\r',
  t: '\t',
};

export function isRawTable(value: unknown): value is RawTable {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorAt(message: string, line: number, sourcePath?: string): TomlSyntaxError {
  return new TomlSyntaxError(message, line, sourcePath);
}

/** Windows editors add a UTF-8 BOM; it is not part of the first key. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Drop a trailing `#` comment, respecting quoted spans. */
function stripTrailingComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (quote === '"' && char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '#') return line.slice(0, index);
  }
  return line;
}

export function parseRestrictedToml(text: string, options: { sourcePath?: string } = {}): TomlDocument {
  const sourcePath = options.sourcePath;
  const root: Record<string, unknown> = {};
  const lines = new Map<string, number>();
  const tables = new Set<string>();
  let current: Record<string, unknown> = root;
  let currentPath: string[] = [];
  const rawLines = stripBom(text).split(/\r\n|\n|\r/);

  for (let index = 0; index < rawLines.length; index += 1) {
    const lineNumber = index + 1;
    const line = stripTrailingComment(rawLines[index] ?? '').trim();
    if (line === '') continue;

    if (line.startsWith('[[')) {
      throw errorAt('arrays of tables ([[...]]) are not supported', lineNumber, sourcePath);
    }

    if (line.startsWith('[')) {
      const header = /^\[\s*([^[\]]*?)\s*\]$/.exec(line);
      if (header === null) throw errorAt(`malformed table header: ${line}`, lineNumber, sourcePath);
      const headerText = header[1] ?? '';
      const segments = headerText.split('.').map((segment) => segment.trim());
      if (segments.some((segment) => segment === '' || !BARE_KEY.test(segment))) {
        throw errorAt(`invalid table name: ${headerText}`, lineNumber, sourcePath);
      }
      const tableKey = segments.join('.');
      if (tables.has(tableKey)) throw errorAt(`duplicate table [${tableKey}]`, lineNumber, sourcePath);
      let node = root;
      for (const segment of segments) {
        const existing = node[segment];
        if (existing === undefined) {
          const created: Record<string, unknown> = {};
          node[segment] = created;
          node = created;
        } else if (isRawTable(existing)) {
          node = existing;
        } else {
          throw errorAt(`[${tableKey}] conflicts with an existing value named "${segment}"`, lineNumber, sourcePath);
        }
      }
      tables.add(tableKey);
      current = node;
      currentPath = segments;
      continue;
    }

    const assignment = findAssignment(line);
    if (assignment < 0) throw errorAt(`expected "key = value": ${line}`, lineNumber, sourcePath);
    const keyText = line.slice(0, assignment).trim();
    const valueText = line.slice(assignment + 1).trim();
    if (keyText === '') throw errorAt('missing key before "="', lineNumber, sourcePath);
    if (keyText.includes('.')) {
      throw errorAt('dotted keys are not supported; declare a [table] header instead', lineNumber, sourcePath);
    }
    const key = unquoteKey(keyText, lineNumber, sourcePath);
    if (key === undefined) throw errorAt(`invalid key: ${keyText}`, lineNumber, sourcePath);
    if (valueText === '') throw errorAt(`missing value for key "${key}"`, lineNumber, sourcePath);
    const fullKey = [...currentPath, key].join('.');
    if (Object.prototype.hasOwnProperty.call(current, key)) {
      throw errorAt(`duplicate key "${fullKey}"`, lineNumber, sourcePath);
    }
    current[key] = parseValue(valueText, lineNumber, sourcePath, fullKey);
    lines.set(fullKey, lineNumber);
  }

  return { root: root as RawTable, lineOf: (key: string) => lines.get(key) };
}

function findAssignment(line: string): number {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (quote === '"' && char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '=') return index;
  }
  return -1;
}

function unquoteKey(keyText: string, line: number, sourcePath?: string): string | undefined {
  if (keyText.startsWith('"') || keyText.startsWith("'")) {
    if (keyText.length < 2 || keyText.at(-1) !== keyText[0]) {
      throw errorAt('unterminated quoted key', line, sourcePath);
    }
    return parseQuoted(keyText, line, sourcePath);
  }
  if (!BARE_KEY.test(keyText)) return undefined;
  return keyText;
}

function parseValue(
  text: string,
  line: number,
  sourcePath: string | undefined,
  key: string,
): RawValue {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (INTEGER.test(text)) {
    const value = Number(text);
    if (!Number.isSafeInteger(value)) throw errorAt(`"${key}": integer is outside the safe range`, line, sourcePath);
    return value;
  }
  if (text.startsWith('"""') || text.startsWith("'''")) {
    throw errorAt(`"${key}": multi-line strings are not supported`, line, sourcePath);
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    if (text.length < 2 || text.at(-1) !== text[0]) {
      throw errorAt(`"${key}": unterminated string`, line, sourcePath);
    }
    return parseQuoted(text, line, sourcePath);
  }
  if (text.startsWith('[')) return parseArray(text, line, sourcePath, key);
  if (text.startsWith('{')) throw errorAt(`"${key}": inline tables are not supported`, line, sourcePath);
  if (FLOAT.test(text)) throw errorAt(`"${key}": floats are not supported; use an integer`, line, sourcePath);
  throw errorAt(`"${key}": unsupported value: ${text}`, line, sourcePath);
}

function parseQuoted(text: string, line: number, sourcePath?: string): string {
  const quote = text[0];
  if (quote !== '"' && quote !== "'") throw errorAt('not a quoted string', line, sourcePath);
  const body = text.slice(1, -1);
  if (quote === "'") return body;
  let out = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = body[index + 1];
    if (next === undefined) throw errorAt('trailing backslash in string', line, sourcePath);
    const replacement = ESCAPES[next];
    if (replacement === undefined) {
      throw errorAt(
        `unsupported escape "\\${next}" (supported: \\\\ \\" \\n \\r \\t)`,
        line,
        sourcePath,
      );
    }
    out += replacement;
    index += 1;
  }
  return out;
}

function parseArray(
  text: string,
  line: number,
  sourcePath: string | undefined,
  key: string,
): readonly RawScalar[] {
  if (!text.endsWith(']')) throw errorAt(`"${key}": unterminated array`, line, sourcePath);
  const inner = text.slice(1, -1).trim();
  if (inner === '') return [];
  const items = splitTopLevel(inner, line, sourcePath);
  const values = items.map((item) => parseValue(item, line, sourcePath, key));
  const kinds = new Set(values.map((value) => typeof value));
  if (kinds.size > 1) throw errorAt(`"${key}": arrays must hold values of a single type`, line, sourcePath);
  return values as readonly RawScalar[];
}

function splitTopLevel(inner: string, line: number, sourcePath?: string): string[] {
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (quote !== null) {
      current += char;
      if (quote === '"' && char === '\\') {
        const next = inner[index + 1];
        if (next !== undefined) {
          current += next;
          index += 1;
        }
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '[' || char === '{') {
      throw errorAt('nested arrays and inline tables are not supported', line, sourcePath);
    }
    if (char === ',') {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (quote !== null) throw errorAt('unterminated string inside array', line, sourcePath);
  items.push(current.trim());
  if (items.some((item) => item === '')) throw errorAt('empty element in array', line, sourcePath);
  return items;
}

/** Serialize a string as a TOML basic string (used for generated defaults). */
export function quoteTomlString(value: string): string {
  const escaped = value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('\t', '\\t');
  return `"${escaped}"`;
}
