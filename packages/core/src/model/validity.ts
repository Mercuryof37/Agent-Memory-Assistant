import type { MemoryDoc, MemoryId } from './types.ts';

/**
 * Validity is derived, never stored back into a file:
 *
 *   effective end = min(valid_until, every successor's valid_from)
 *
 * A memory is active on a date when `valid_from <= date < effective end`.
 * Supersede edges point from the successor to the memory it replaces, so the
 * reverse map below is rebuilt from the files on every scan.
 */

export type SuccessorMap = ReadonlyMap<MemoryId, readonly MemoryId[]>;

export function buildSuccessorMap(docs: Iterable<MemoryDoc>): Map<MemoryId, MemoryId[]> {
  const map = new Map<MemoryId, MemoryId[]>();
  for (const doc of docs) {
    for (const target of doc.supersedes) {
      const list = map.get(target);
      if (list === undefined) map.set(target, [doc.id]);
      else list.push(doc.id);
    }
  }
  return map;
}

/** Today as `YYYY-MM-DD` in the host's local time zone (the store's date basis). */
export function today(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface DatedPeriod {
  readonly valid_from: string;
  readonly valid_until: string | null;
  /** Ids of memories that supersede this one. */
  readonly successors: readonly MemoryId[];
}

/**
 * `validFromOf` resolves a successor id to its `valid_from`; passing it in keeps
 * the validity helpers independent of a document collection.
 */
export function endFor(period: DatedPeriod, validFromOf: (id: MemoryId) => string | undefined): string | null {
  let end = period.valid_until;
  for (const successorId of period.successors) {
    const start = validFromOf(successorId);
    if (start === undefined) continue;
    if (end === null || start < end) end = start;
  }
  return end;
}

export function isActiveOn(
  period: DatedPeriod,
  date: string,
  validFromOf: (id: MemoryId) => string | undefined,
): boolean {
  if (date < period.valid_from) return false;
  const end = endFor(period, validFromOf);
  return end === null || date < end;
}

/** Build the `validFromOf` lookup used by the helpers above. */
export function validFromLookup(docs: Iterable<MemoryDoc>): (id: MemoryId) => string | undefined {
  const map = new Map<MemoryId, string>();
  for (const doc of docs) map.set(doc.id, doc.valid_from);
  return (id) => map.get(id);
}

/** Active docs on `date`, newest first by valid_from then id (deterministic). */
export function activeDocs(docs: Iterable<MemoryDoc>, date: string): MemoryDoc[] {
  const all = [...docs];
  const validFromOf = validFromLookup(all);
  const successors = buildSuccessorMap(all);
  return all
    .filter((doc) =>
      isActiveOn(
        {
          valid_from: doc.valid_from,
          valid_until: doc.valid_until,
          successors: successors.get(doc.id) ?? [],
        },
        date,
        validFromOf,
      ),
    )
    .sort((left, right) => {
      if (left.valid_from !== right.valid_from) return right.valid_from.localeCompare(left.valid_from);
      return left.id.localeCompare(right.id);
    });
}

/**
 * Problems that make a new/updated supersede edge invalid. The candidate is
 * not yet in `docs`; its id must not be reachable from any target.
 */
export function supersedeProblems(
  candidate: { readonly id: MemoryId; readonly supersedes: readonly MemoryId[]; readonly valid_from: string },
  docs: ReadonlyMap<MemoryId, MemoryDoc>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const target of candidate.supersedes) {
    if (seen.has(target)) problems.push(`supersedes lists "${target}" twice`);
    seen.add(target);
    const doc = docs.get(target);
    if (doc === undefined) {
      problems.push(`supersedes target "${target}" does not exist`);
      continue;
    }
    if (doc.valid_from > candidate.valid_from) {
      problems.push(`supersedes target "${target}" starts after the successor (${doc.valid_from} > ${candidate.valid_from})`);
    }
    const stack = [...doc.supersedes];
    const visited = new Set<MemoryId>();
    while (stack.length > 0) {
      const current = stack.pop() as MemoryId;
      if (current === candidate.id) {
        problems.push(`supersede chain would form a cycle through "${target}"`);
        break;
      }
      if (visited.has(current)) continue;
      visited.add(current);
      const next = docs.get(current);
      if (next !== undefined) stack.push(...next.supersedes);
    }
  }
  return problems;
}
