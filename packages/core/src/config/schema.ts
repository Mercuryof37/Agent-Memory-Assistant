/**
 * Declarative schema validation shared by config.toml and policy.json.
 *
 * Both files are strict: an unknown key is a startup failure, never a warning
 * that gets ignored. The messages name the offending dotted key so a human can
 * fix it without reading this source file.
 */

import type { ConfigProblem } from '../errors.ts';
import { isRawTable, type RawScalar, type RawTable, type RawValue } from './toml.ts';

export type FieldSpec =
  | { readonly type: 'string'; readonly default?: string; readonly nonEmpty?: boolean }
  | {
      readonly type: 'int';
      readonly default?: number;
      readonly min?: number;
      readonly max?: number;
    }
  | { readonly type: 'bool'; readonly default?: boolean }
  | { readonly type: 'enum'; readonly values: readonly string[]; readonly default?: string }
  | {
      readonly type: 'string[]';
      readonly values?: readonly string[];
      readonly default?: readonly string[];
    };

export interface TableSpec {
  readonly [key: string]: FieldSpec | TableSpec;
}

export interface ValidationResult {
  readonly values: RawTable;
  readonly problems: readonly ConfigProblem[];
}

export interface ValidateOptions {
  readonly prefix?: string;
  readonly lineOf?: (key: string) => number | undefined;
}

export function isFieldSpec(spec: FieldSpec | TableSpec): spec is FieldSpec {
  return 'type' in spec;
}

export function isArrayValue(value: unknown): value is readonly RawScalar[] {
  return Array.isArray(value);
}

export function validateAgainstSchema(
  schema: TableSpec,
  raw: RawTable,
  options: ValidateOptions = {},
): ValidationResult {
  const problems: ConfigProblem[] = [];
  const values = walk(schema, raw, options.prefix ?? '', problems, options.lineOf);
  return { values, problems };
}

/** Every field key of a schema, dotted and sorted. Used by the docs gate. */
export function schemaKeys(schema: TableSpec, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [name, spec] of Object.entries(schema)) {
    const key = prefix === '' ? name : `${prefix}.${name}`;
    if (isFieldSpec(spec)) keys.push(key);
    else keys.push(...schemaKeys(spec, key));
  }
  return keys.sort();
}

/** All-default values for a schema. */
export function schemaDefaults(schema: TableSpec): RawTable {
  return validateAgainstSchema(schema, {}).values;
}

function walk(
  schema: TableSpec,
  raw: RawTable,
  prefix: string,
  problems: ConfigProblem[],
  lineOf: ((key: string) => number | undefined) | undefined,
): RawTable {
  const out: Record<string, RawValue | RawTable> = {};
  const seen = new Set<string>();
  const known = new Map(Object.entries(schema));

  for (const [name, rawValue] of Object.entries(raw)) {
    seen.add(name);
    const key = prefix === '' ? name : `${prefix}.${name}`;
    const line = lineOf?.(key);
    const spec = known.get(name);

    if (spec === undefined) {
      problems.push({
        key,
        message: unknownKeyMessage(key, name, known),
        ...(line === undefined ? {} : { line }),
      });
      continue;
    }

    if (isFieldSpec(spec)) {
      if (isRawTable(rawValue)) {
        problems.push({
          key,
          message: `"${key}" must be ${typeLabel(spec)}, not a table`,
          ...(line === undefined ? {} : { line }),
        });
        continue;
      }
      const checked = checkField(spec, rawValue, key, problems);
      if (checked !== undefined) out[name] = checked;
      continue;
    }

    if (!isRawTable(rawValue)) {
      problems.push({
        key,
        message: `"${key}" must be a table ([${key}]), not ${describeValue(rawValue)}`,
        ...(line === undefined ? {} : { line }),
      });
      continue;
    }
    out[name] = walk(spec, rawValue, key, problems, lineOf);
  }

  for (const [name, spec] of Object.entries(schema)) {
    if (seen.has(name)) continue;
    const key = prefix === '' ? name : `${prefix}.${name}`;
    if (isFieldSpec(spec)) {
      if (spec.default !== undefined) out[name] = spec.default;
      else problems.push({ key, message: `missing required key "${key}"` });
      continue;
    }
    out[name] = walk(spec, {}, key, problems, lineOf);
  }

  return out;
}

function checkField(
  spec: FieldSpec,
  value: RawValue,
  key: string,
  problems: ConfigProblem[],
): RawValue | undefined {
  const fail = (message: string): undefined => {
    problems.push({ key, message });
    return undefined;
  };

  switch (spec.type) {
    case 'string': {
      if (typeof value !== 'string') return fail(`"${key}" must be ${typeLabel(spec)}, not ${describeValue(value)}`);
      if (spec.nonEmpty === true && value.trim() === '') return fail(`"${key}" must not be empty`);
      return value;
    }
    case 'int': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return fail(`"${key}" must be ${typeLabel(spec)}, not ${describeValue(value)}`);
      }
      if (spec.min !== undefined && value < spec.min) {
        return fail(`"${key}" must be at least ${spec.min}, found ${value}`);
      }
      if (spec.max !== undefined && value > spec.max) {
        return fail(`"${key}" must be at most ${spec.max}, found ${value}`);
      }
      return value;
    }
    case 'bool': {
      if (typeof value !== 'boolean') return fail(`"${key}" must be ${typeLabel(spec)}, not ${describeValue(value)}`);
      return value;
    }
    case 'enum': {
      if (typeof value !== 'string' || !spec.values.includes(value)) {
        return fail(`"${key}" must be ${typeLabel(spec)}, not ${describeValue(value)}`);
      }
      return value;
    }
    case 'string[]': {
      if (!isArrayValue(value) || !value.every((item) => typeof item === 'string')) {
        return fail(`"${key}" must be ${typeLabel(spec)}, not ${describeValue(value)}`);
      }
      const strings = value as readonly string[];
      if (spec.values !== undefined) {
        const bad = strings.find((item) => !spec.values?.includes(item));
        if (bad !== undefined) return fail(`"${key}" may only contain ${typeLabel(spec)}; found "${bad}"`);
      }
      return strings;
    }
  }
}

export function typeLabel(spec: FieldSpec): string {
  switch (spec.type) {
    case 'string':
      return 'a string';
    case 'int':
      return 'an integer';
    case 'bool':
      return 'a boolean';
    case 'enum':
      return `one of ${spec.values.map((value) => `"${value}"`).join(', ')}`;
    case 'string[]':
      return spec.values === undefined
        ? 'an array of strings'
        : `an array of ${spec.values.map((value) => `"${value}"`).join(', ')}`;
  }
}

function describeValue(value: unknown): string {
  if (isRawTable(value)) return 'a table';
  if (isArrayValue(value)) return 'an array';
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
  if (typeof value === 'number') return `the integer ${value}`;
  return `the boolean ${String(value)}`;
}

function unknownKeyMessage(key: string, name: string, known: ReadonlyMap<string, FieldSpec | TableSpec>): string {
  const suggestion = suggestKey(name, known.keys());
  if (suggestion === undefined) return `unknown key "${key}"`;
  const prefix = key.slice(0, key.length - name.length);
  return `unknown key "${key}" (did you mean "${prefix}${suggestion}"?)`;
}

function suggestKey(name: string, candidates: Iterable<string>): string | undefined {
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = editDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance > 2) continue;
    if (best === undefined || distance < best.distance) best = { candidate, distance };
  }
  return best?.candidate;
}

function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous: number[] = Array.from({ length: cols }, (_, index) => index);
  for (let row = 1; row < rows; row += 1) {
    const current: number[] = [row];
    for (let col = 1; col < cols; col += 1) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      const above = previous[col] ?? 0;
      const left = current[col - 1] ?? 0;
      const diagonal = previous[col - 1] ?? 0;
      current[col] = Math.min(above + 1, left + 1, diagonal + cost);
    }
    previous = current;
  }
  return previous[cols - 1] ?? 0;
}
