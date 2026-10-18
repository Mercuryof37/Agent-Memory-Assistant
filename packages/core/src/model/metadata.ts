import type { MemoryRelation, MemorySource, RelationType } from './types.ts';

/**
 * Metadata limits for the v1.4 fields (`project`, `tags`, `relations`).
 *
 * Kept in one module so the file parser and the store reject the same shapes.
 * Relations deliberately stop at three edge families: `supersedes` remains its
 * own immutable field; `relates_to`/`derived_from` live here.
 */

export const PROJECT_NAME_MAX = 64;
export const TAG_MAX = 32;
export const TAGS_MAX = 8;
export const RELATIONS_MAX = 16;

const RELATION_TYPES: readonly RelationType[] = ['relates_to', 'derived_from'];
const MEMORY_ID = /^mem-\d{8}-[0-9a-f]{8}$/;

export function projectProblem(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return 'project must be a string or null';
  const name = value.trim();
  if (name === '') return 'project must not be empty';
  if (name !== value) return 'project must not have leading or trailing whitespace';
  if ([...name].length > PROJECT_NAME_MAX) {
    return `project must be at most ${PROJECT_NAME_MAX} characters`;
  }
  if (/[\r\n]/.test(name)) return 'project must be a single line';
  if (/[\\/]/.test(name)) return 'project must not contain path separators';
  if (name === '未归类') return 'project name "未归类" is reserved for the default bucket';
  return undefined;
}

export function tagsProblem(value: unknown): string | undefined {
  if (!Array.isArray(value)) return 'tags must be an array';
  if (value.length > TAGS_MAX) return `tags allows at most ${TAGS_MAX} entries`;
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') return 'each tag must be a string';
    if (entry.length === 0) return 'tags must not contain empty entries';
    if ([...entry].length > TAG_MAX) return `each tag must be at most ${TAG_MAX} characters`;
    if (/[\r\n]/.test(entry)) return 'tags must be single-line';
    if (seen.has(entry)) return `duplicate tag "${entry}"`;
    seen.add(entry);
  }
  return undefined;
}

export function relationsProblem(value: unknown, selfId?: string): string | undefined {
  if (!Array.isArray(value)) return 'relations must be an array';
  if (value.length > RELATIONS_MAX) return `relations allows at most ${RELATIONS_MAX} entries`;
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return 'each relation must be an object';
    }
    const relation = entry as { type?: unknown; target?: unknown };
    if (typeof relation.type !== 'string' || !RELATION_TYPES.includes(relation.type as RelationType)) {
      return 'relation.type must be relates_to or derived_from';
    }
    if (typeof relation.target !== 'string' || !MEMORY_ID.test(relation.target)) {
      return 'relation.target must look like mem-YYYYMMDD-8hex';
    }
    if (relation.target === selfId) return 'a relation must not target itself';
    const key = `${relation.type}:${relation.target}`;
    if (seen.has(key)) return 'relations must not contain duplicates';
    seen.add(key);
  }
  return undefined;
}

export function normalizeRelations(value: readonly MemoryRelation[] | undefined): readonly MemoryRelation[] {
  if (value === undefined || value.length === 0) return [];
  return value.map((relation) => ({ type: relation.type, target: relation.target }));
}

/** External provenance marker for imported records (Mem0 first). */
export function sourceProblem(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return 'source must be an object or null';
  const source = value as { type?: unknown; id?: unknown };
  if (typeof source.type !== 'string' || source.type.length === 0 || [...source.type].length > 32) {
    return 'source.type must be a non-empty string up to 32 characters';
  }
  if (typeof source.id !== 'string' || source.id.length === 0 || [...source.id].length > 128) {
    return 'source.id must be a non-empty string up to 128 characters';
  }
  if (/[\r\n]/.test(source.type) || /[\r\n]/.test(source.id)) return 'source values must be single-line';
  return undefined;
}

export function normalizeSource(value: MemorySource | null | undefined): MemorySource | null {
  if (value === null || value === undefined) return null;
  return { type: value.type, id: value.id };
}
