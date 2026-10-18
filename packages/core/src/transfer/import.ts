import type { Kind } from '../model/types.ts';
import type { MemoryStore } from '../store/store.ts';

/**
 * Import an `agent-memory-export-v1` bundle (the JSON produced by the GUI
 * export button or `mem export`). Memory content is re-added through the store
 * so locks, validation, journaling and dedupe stay in one place.
 *
 * - Duplicate content (same content_hash) is skipped, not duplicated.
 * - Imported records are authored by the human doing the import; provenance is
 *   carried as-is (the source sessions may not exist on this machine, so the
 *   evidence can show as unverifiable rather than being rewritten).
 * - Pending proposals are not imported: a proposal must target a live record
 *   in this store, and silently recreating one would bypass the human queue.
 */

export interface ImportReport {
  readonly imported: number;
  readonly skipped: number;
  readonly failed: readonly { readonly abstract: string; readonly error: string }[];
  readonly ignored_proposals: number;
}

export interface ImportMemory {
  readonly kind: string;
  readonly abstract: string;
  readonly body?: string;
  readonly project?: string | null;
  readonly tags?: readonly string[];
  readonly relations?: readonly unknown[];
  readonly valid_from?: string;
  readonly error_signatures?: readonly string[];
  readonly evidence_level?: string;
  readonly provenance?: readonly unknown[];
}

const KINDS: readonly Kind[] = ['fact', 'pitfall', 'exp'];
const LEVELS = new Set(['user_explicit', 'user_confirmed', 'observed']);

export function importBundle(store: MemoryStore, bundle: unknown): ImportReport {
  if (typeof bundle !== 'object' || bundle === null) throw new Error('bundle must be an object');
  const record = bundle as { format?: unknown; memories?: unknown; proposals?: unknown };
  if (record.format !== 'agent-memory-export-v1' && record.format !== 'agent-memory-export-v2') {
    throw new Error('unsupported bundle format (expected agent-memory-export-v1 or v2)');
  }
  if (!Array.isArray(record.memories)) throw new Error('bundle.memories must be an array');

  let imported = 0;
  let skipped = 0;
  const failed: { abstract: string; error: string }[] = [];

  for (const raw of record.memories as ImportMemory[]) {
    const abstract = typeof raw?.abstract === 'string' ? raw.abstract : '';
    try {
      if (typeof raw !== 'object' || raw === null) throw new Error('entry must be an object');
      if (typeof raw.kind !== 'string' || !KINDS.includes(raw.kind as Kind)) {
        throw new Error(`kind must be one of ${KINDS.join(', ')}`);
      }
      if (abstract.trim() === '') throw new Error('abstract is required');
      const body = typeof raw.body === 'string' ? raw.body : '';
      const evidenceLevel = typeof raw.evidence_level === 'string' && LEVELS.has(raw.evidence_level)
        ? (raw.evidence_level as 'user_explicit' | 'user_confirmed' | 'observed')
        : 'observed';
      const provenance = Array.isArray(raw.provenance) ? raw.provenance : [];
      const result = store.add(
        {
          kind: raw.kind as Kind,
          abstract,
          body,
          ...(typeof raw.project === 'string' || raw.project === null ? { project: raw.project } : {}),
          ...(Array.isArray(raw.tags)
            ? { tags: raw.tags.filter((entry): entry is string => typeof entry === 'string') }
            : {}),
          ...(Array.isArray(raw.relations)
            ? {
                relations: raw.relations.filter(
                  (entry): entry is { type: 'relates_to' | 'derived_from'; target: string } =>
                    typeof entry === 'object' &&
                    entry !== null &&
                    typeof (entry as { type?: unknown }).type === 'string' &&
                    typeof (entry as { target?: unknown }).target === 'string',
                ),
              }
            : {}),
          evidence_level: evidenceLevel,
          ...(typeof raw.valid_from === 'string' ? { valid_from: raw.valid_from } : {}),
          ...(Array.isArray(raw.error_signatures)
            ? { error_signatures: raw.error_signatures.filter((entry): entry is string => typeof entry === 'string') }
            : {}),
        },
        { author: 'human', provenance: provenance as never },
      );
      if (result.deduplicated) skipped += 1;
      else imported += 1;
    } catch (error) {
      failed.push({ abstract: abstract || '(no abstract)', error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    imported,
    skipped,
    failed,
    ignored_proposals: Array.isArray(record.proposals) ? record.proposals.length : 0,
  };
}
