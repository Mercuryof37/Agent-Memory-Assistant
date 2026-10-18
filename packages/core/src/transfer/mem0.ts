import type { Kind } from '../model/types.ts';
import type { MemoryStore } from '../store/store.ts';
import type { ImportReport } from './import.ts';

/**
 * Mem0 import adapter (V4.0-S3a).
 *
 * Accepts the three shapes Mem0 users commonly have:
 * - `{ results: [...] }` (platform API list)
 * - `{ memories: [...] }` (export wrapper)
 * - a bare array
 *
 * Writes go through `store.add`, so locks, validation, journal and content
 * dedupe stay in one place. The original Mem0 id is kept in `source`, never as
 * fake DSH provenance.
 */

export interface Mem0ImportReport extends ImportReport {
  readonly source: 'mem0';
  readonly byKind: Readonly<Record<string, number>>;
  readonly byProject: Readonly<Record<string, number>>;
}

export interface Mem0Preview {
  readonly total: number;
  readonly valid: number;
  readonly invalid: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly byProject: Readonly<Record<string, number>>;
  readonly samples: readonly { readonly abstract: string; readonly kind: string }[];
  readonly errors: readonly { readonly index: number; readonly reason: string }[];
}

const KINDS: readonly Kind[] = ['fact', 'pitfall', 'exp'];

function entriesOf(bundle: unknown): readonly unknown[] {
  if (Array.isArray(bundle)) return bundle;
  if (typeof bundle !== 'object' || bundle === null) throw new Error('Mem0 bundle must be an array or object');
  const record = bundle as { results?: unknown; memories?: unknown };
  if (Array.isArray(record.results)) return record.results;
  if (Array.isArray(record.memories)) return record.memories;
  throw new Error('Mem0 bundle needs a results[] or memories[] array');
}

function clip(text: string, max: number): string {
  const chars = [...text.replace(/[\r\n]+/g, ' ').trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
}

interface Normalized {
  readonly kind: Kind;
  readonly abstract: string;
  readonly body: string;
  readonly project?: string;
  readonly tags?: readonly string[];
  readonly valid_from?: string;
  readonly source: { readonly type: 'mem0'; readonly id: string };
}

function normalize(raw: unknown, index: number): Normalized {
  if (typeof raw !== 'object' || raw === null) throw new Error('entry must be an object');
  const entry = raw as {
    id?: unknown;
    memory?: unknown;
    text?: unknown;
    content?: unknown;
    metadata?: unknown;
    categories?: unknown;
    created_at?: unknown;
  };
  const memory =
    typeof entry.memory === 'string'
      ? entry.memory
      : typeof entry.text === 'string'
        ? entry.text
        : typeof entry.content === 'string'
          ? entry.content
          : '';
  if (memory.trim() === '') throw new Error('memory/text/content is empty');
  const metadata =
    typeof entry.metadata === 'object' && entry.metadata !== null && !Array.isArray(entry.metadata)
      ? (entry.metadata as Record<string, unknown>)
      : {};
  const rawKind = typeof metadata.kind === 'string' ? metadata.kind : 'fact';
  if (!KINDS.includes(rawKind as Kind)) throw new Error(`metadata.kind must be fact, pitfall or exp`);
  const project =
    typeof metadata.project === 'string'
      ? metadata.project.trim()
      : typeof metadata.workspace === 'string'
        ? metadata.workspace.trim()
        : undefined;
  const tagsSource = Array.isArray(metadata.tags) ? metadata.tags : Array.isArray(entry.categories) ? entry.categories : [];
  const tags = tagsSource.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').slice(0, 8);
  const created = typeof entry.created_at === 'string' ? entry.created_at.slice(0, 10) : undefined;
  const validFrom = created !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(created) ? created : undefined;
  const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : `row-${index + 1}`;
  return {
    kind: rawKind as Kind,
    abstract: clip(memory, 120),
    body: memory,
    ...(project === undefined || project === '' ? {} : { project }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(validFrom === undefined ? {} : { valid_from: validFrom }),
    source: { type: 'mem0', id },
  };
}

export function previewMem0(bundle: unknown): Mem0Preview {
  const entries = entriesOf(bundle);
  const byKind: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  const samples: { abstract: string; kind: string }[] = [];
  const errors: { index: number; reason: string }[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    try {
      const normalized = normalize(entries[index], index);
      byKind[normalized.kind] = (byKind[normalized.kind] ?? 0) + 1;
      const project = normalized.project ?? '未归类';
      byProject[project] = (byProject[project] ?? 0) + 1;
      if (samples.length < 3) samples.push({ abstract: normalized.abstract, kind: normalized.kind });
    } catch (error) {
      errors.push({ index, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return {
    total: entries.length,
    valid: entries.length - errors.length,
    invalid: errors.length,
    byKind,
    byProject,
    samples,
    errors,
  };
}

export function importMem0(store: MemoryStore, bundle: unknown): Mem0ImportReport {
  const entries = entriesOf(bundle);
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const byKind: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  const errors: { abstract: string; error: string }[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    let abstract = '';
    try {
      const normalized = normalize(entries[index], index);
      abstract = normalized.abstract;
      const result = store.add(
        {
          kind: normalized.kind,
          abstract: normalized.abstract,
          body: normalized.body,
          ...(normalized.project === undefined ? {} : { project: normalized.project }),
          ...(normalized.tags === undefined ? {} : { tags: normalized.tags }),
          ...(normalized.valid_from === undefined ? {} : { valid_from: normalized.valid_from }),
          source: normalized.source,
          evidence_level: 'observed',
        },
        { author: 'human' },
      );
      if (result.deduplicated) skipped += 1;
      else {
        imported += 1;
        byKind[normalized.kind] = (byKind[normalized.kind] ?? 0) + 1;
        const project = normalized.project ?? '未归类';
        byProject[project] = (byProject[project] ?? 0) + 1;
      }
    } catch (error) {
      failed += 1;
      errors.push({ abstract: abstract || `(row ${index + 1})`, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    source: 'mem0',
    imported,
    skipped,
    failed: errors,
    ignored_proposals: 0,
    byKind,
    byProject,
  };
}
