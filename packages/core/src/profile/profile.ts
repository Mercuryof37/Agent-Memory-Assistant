import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from '../fs/atomic.ts';
import { memoryPaths } from '../paths.ts';

/**
 * USER.md profile entries (architecture v2, P1). One entry per paragraph,
 * separated by a line containing only `§`; comments are stripped before
 * reading/writing so the scaffold template stays inert.
 *
 * The file stays human-editable; the agent may only change it through the
 * `user_profile` tool, which requires a confirmation card and a prior read.
 */

export const PROFILE_SEPARATOR = '§';
export const PROFILE_MAX_CHARS = 10000;

export class ProfileError extends Error {
  readonly code: 'INVALID' | 'CONFLICT' | 'NOT_FOUND';
  constructor(code: ProfileError['code'], message: string) {
    super(message);
    this.name = 'ProfileError';
    this.code = code;
  }
}

export interface ProfileSnapshot {
  readonly entries: readonly string[];
  readonly chars: number;
}

const COMMENT = /<!--[\s\S]*?-->/g;

export function stripProfileComments(text: string): string {
  return text.replace(COMMENT, '');
}

export function parseProfileEntries(text: string): string[] {
  const entries: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    const value = current.join('\n').trim();
    if (value !== '') entries.push(value);
    current = [];
  };
  for (const line of stripProfileComments(text).split(/\r?\n/)) {
    if (line.trim() === PROFILE_SEPARATOR) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return entries;
}

export function renderProfileEntries(entries: readonly string[]): string {
  return `${entries.map((entry) => entry.trim()).join(`\n\n${PROFILE_SEPARATOR}\n\n`)}\n`;
}

function profileChars(entries: readonly string[]): number {
  return [...renderProfileEntries(entries)].length;
}

export function validateProfileEntries(entries: readonly string[]): string[] {
  const problems: string[] = [];
  entries.forEach((entry, index) => {
    const text = entry.trim();
    if (text === '') problems.push(`entry ${index + 1} is empty`);
    if (text.split(/\r?\n/).some((line) => line.trim() === PROFILE_SEPARATOR)) {
      problems.push(`entry ${index + 1} contains a separator line; use a new entry instead`);
    }
  });
  if (profileChars(entries) > PROFILE_MAX_CHARS) {
    problems.push(`USER.md would be ${profileChars(entries)} chars, over the ${PROFILE_MAX_CHARS}-char limit`);
  }
  return problems;
}

export function loadProfile(home: string): ProfileSnapshot {
  const file = memoryPaths(home).userFile;
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const entries = parseProfileEntries(text);
  return { entries, chars: profileChars(entries) };
}

export function saveProfile(home: string, entries: readonly string[]): ProfileSnapshot {
  const problems = validateProfileEntries(entries);
  if (problems.length > 0) throw new ProfileError('INVALID', problems.join('; '));
  writeFileAtomic(memoryPaths(home).userFile, renderProfileEntries(entries));
  return { entries: entries.map((entry) => entry.trim()), chars: profileChars(entries) };
}

/** Literal query over entries: substring match, case-insensitive for ASCII. */
export function queryProfile(entries: readonly string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...entries];
  return entries.filter((entry) => entry.toLowerCase().includes(needle));
}

/** Find one entry by complete text or a unique literal substring. */
export function findProfileEntry(entries: readonly string[], oldText: string): number {
  const needle = oldText.trim();
  if (needle === '') throw new ProfileError('INVALID', 'old_text is required');
  const exact = entries.findIndex((entry) => entry === needle);
  if (exact !== -1) return exact;
  const matches = entries
    .map((entry, index) => ({ entry, index }))
    .filter((item) => item.entry.includes(needle));
  if (matches.length === 0) throw new ProfileError('NOT_FOUND', 'old_text does not match any USER entry');
  if (matches.length > 1) {
    throw new ProfileError('CONFLICT', `old_text matches ${matches.length} entries; give the complete entry`);
  }
  return (matches[0] as { index: number }).index;
}
