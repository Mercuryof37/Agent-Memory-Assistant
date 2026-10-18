import { createHash } from 'node:crypto';
import type { EvidenceLevel, Kind, MemoryDoc, MemoryRelation, ProvenanceEntry, RelationType } from './types.ts';
import { projectProblem, relationsProblem, sourceProblem, tagsProblem } from './metadata.ts';

/**
 * Frontmatter is one `key: <JSON value>` per line between two `---` fences.
 *
 * That is the whole format: no YAML parser, no aliases, no multi-line values.
 * Unknown or duplicated keys, missing required fields, a second inline object on
 * one line, or a value whose JSON type is wrong all refuse the file — a
 * half-understood memory is worse than a rejected one.
 */

export interface MemoryLimits {
  readonly abstractChars: number;
  readonly bodyChars: number;
  readonly maxRecordChars: number;
}

export class FrontmatterError extends Error {
  readonly field: string;
  readonly filePath: string | undefined;

  constructor(field: string, message: string, filePath?: string) {
    super(`${field}: ${message}`);
    this.name = 'FrontmatterError';
    this.field = field;
    this.filePath = filePath;
  }
}

const FIELD_ORDER = [
  'id',
  'mem_schema',
  'kind',
  'scope',
  'project',
  'tags',
  'relations',
  'source',
  'abstract',
  'created_at',
  'valid_from',
  'valid_until',
  'supersedes',
  'author',
  'evidence_level',
  'error_signatures',
  'provenance',
] as const;

const FIELD_SET = new Set<string>(FIELD_ORDER);
const KINDS = new Set<Kind>(['fact', 'pitfall', 'exp']);
const EVIDENCE = new Set<EvidenceLevel>(['user_explicit', 'user_confirmed', 'observed', 'inferred']);
const SPEAKERS = new Set(['user', 'assistant', 'tool', 'system']);

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ID = /^mem-\d{8}-[0-9a-f]{8}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function normalizeText(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replaceAll('\r\n', '\n').replace(/\n*$/, '\n');
}

export function hashContent(text: string): string {
  return createHash('sha256').update(normalizeText(text), 'utf8').digest('hex');
}

function isValidDate(value: string): boolean {
  const match = DATE.exec(value);
  if (match === null) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

function fail(field: string, message: string, filePath?: string): never {
  throw new FrontmatterError(field, message, filePath);
}

function requireString(value: unknown, field: string, filePath: string | undefined): string {
  if (typeof value !== 'string') fail(field, `must be a string, found ${JSON.stringify(value)}`, filePath);
  return value;
}

function requireArray(value: unknown, field: string, filePath: string | undefined): readonly unknown[] {
  if (!Array.isArray(value)) fail(field, `must be an array, found ${JSON.stringify(value)}`, filePath);
  return value;
}

export function parseMemoryFile(text: string, filePath: string, limits: MemoryLimits): MemoryDoc {
  const normalized = normalizeText(text);
  if (!normalized.startsWith('---\n')) fail('frontmatter', 'file must start with a "---" fence', filePath);
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) fail('frontmatter', 'missing closing "---" fence', filePath);

  const header = normalized.slice(4, end);
  const body = normalized.slice(end + 5);

  const values = new Map<string, unknown>();
  for (const line of header.split('\n')) {
    if (line.trim() === '') fail('frontmatter', 'blank line inside the frontmatter', filePath);
    const separator = line.indexOf(': ');
    if (separator < 0) fail('frontmatter', `line is not "key: <JSON>": ${line.slice(0, 40)}`, filePath);
    const key = line.slice(0, separator);
    if (!/^[a-z_]+$/.test(key)) fail('frontmatter', `invalid key "${key}"`, filePath);
    if (!FIELD_SET.has(key)) fail(key, 'unknown frontmatter key', filePath);
    if (values.has(key)) fail(key, 'duplicate frontmatter key', filePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice(separator + 2));
    } catch {
      fail(key, 'value is not valid JSON', filePath);
    }
    values.set(key, parsed);
  }

  for (const field of ['id', 'mem_schema', 'kind', 'scope', 'abstract', 'created_at', 'valid_from']) {
    if (!values.has(field)) fail(field, 'missing required field', filePath);
  }

  const id = requireString(values.get('id'), 'id', filePath);
  if (!ID.test(id)) fail('id', 'must look like mem-YYYYMMDD-8hex', filePath);
  if (values.get('mem_schema') !== 1 && values.get('mem_schema') !== 2) {
    fail('mem_schema', 'must be 1 or 2', filePath);
  }
  const memSchema = values.get('mem_schema') as 1 | 2;
  const kind = requireString(values.get('kind'), 'kind', filePath);
  if (!KINDS.has(kind as Kind)) fail('kind', 'must be fact, pitfall or exp', filePath);
  if (values.get('scope') !== 'local') fail('scope', 'must be "local" in V1', filePath);

  const rawProject = values.has('project') ? values.get('project') : null;
  const projectIssue = projectProblem(rawProject);
  if (projectIssue !== undefined) fail('project', projectIssue, filePath);
  const project = rawProject === null || rawProject === undefined ? null : (rawProject as string);

  const rawTags = values.has('tags') ? values.get('tags') : [];
  const tagsIssue = tagsProblem(rawTags);
  if (tagsIssue !== undefined) fail('tags', tagsIssue, filePath);
  const tags = requireArray(rawTags, 'tags', filePath).map((entry) => entry as string);

  const rawRelations = values.has('relations') ? values.get('relations') : [];
  const relationsIssue = relationsProblem(rawRelations, id);
  if (relationsIssue !== undefined) fail('relations', relationsIssue, filePath);
  const relations = requireArray(rawRelations, 'relations', filePath).map((entry) => {
    const relation = entry as { type: RelationType; target: string };
    return { type: relation.type, target: relation.target } satisfies MemoryRelation;
  });

  const rawSource = values.has('source') ? values.get('source') : null;
  const sourceIssue = sourceProblem(rawSource);
  if (sourceIssue !== undefined) fail('source', sourceIssue, filePath);
  const source = rawSource === null || rawSource === undefined ? null : (rawSource as { type: string; id: string });

  const abstract = requireString(values.get('abstract'), 'abstract', filePath);
  if (abstract.trim() === '') fail('abstract', 'must not be empty', filePath);
  if (/[\r\n]/.test(abstract)) fail('abstract', 'must be a single line', filePath);
  if ([...abstract].length > limits.abstractChars) {
    fail('abstract', `exceeds limits.abstract_chars (${limits.abstractChars})`, filePath);
  }

  const createdAt = requireString(values.get('created_at'), 'created_at', filePath);
  if (!TIMESTAMP.test(createdAt)) fail('created_at', 'must be an ISO timestamp with an offset', filePath);

  const validFrom = requireString(values.get('valid_from'), 'valid_from', filePath);
  if (!isValidDate(validFrom)) fail('valid_from', 'must be a real YYYY-MM-DD date', filePath);

  const rawValidUntil = values.has('valid_until') ? values.get('valid_until') : null;
  let validUntil: string | null = null;
  if (rawValidUntil !== null) {
    validUntil = requireString(rawValidUntil, 'valid_until', filePath);
    if (!isValidDate(validUntil)) fail('valid_until', 'must be null or a real YYYY-MM-DD date', filePath);
    if (validUntil <= validFrom) fail('valid_until', 'must be after valid_from', filePath);
  }

  const rawSupersedes = values.has('supersedes') ? values.get('supersedes') : [];
  const supersedes = requireArray(rawSupersedes, 'supersedes', filePath).map((entry) => {
    const target = requireString(entry, 'supersedes[]', filePath);
    if (!ID.test(target)) fail('supersedes[]', `invalid memory id "${target}"`, filePath);
    return target;
  });
  if (new Set(supersedes).size !== supersedes.length) fail('supersedes', 'must not contain duplicates', filePath);
  if (supersedes.includes(id)) fail('supersedes', 'must not reference itself', filePath);

  const author = requireString(values.get('author'), 'author', filePath);
  if (author !== 'agent' && author !== 'human') fail('author', 'must be agent or human', filePath);

  const evidenceLevel = requireString(values.get('evidence_level'), 'evidence_level', filePath);
  if (!EVIDENCE.has(evidenceLevel as EvidenceLevel)) {
    fail('evidence_level', 'must be user_explicit, user_confirmed, observed or inferred', filePath);
  }

  const rawSignatures = values.has('error_signatures') ? values.get('error_signatures') : [];
  const errorSignatures = requireArray(rawSignatures, 'error_signatures', filePath).map((entry) => {
    const signature = requireString(entry, 'error_signatures[]', filePath);
    if (signature.length === 0) fail('error_signatures[]', 'must not be empty', filePath);
    if ([...signature].length > 80) fail('error_signatures[]', 'must be at most 80 characters', filePath);
    return signature;
  });
  if (errorSignatures.length > 3) fail('error_signatures', 'must contain at most 3 entries', filePath);
  if (kind === 'pitfall' && errorSignatures.length === 0) {
    fail('error_signatures', 'a pitfall must declare at least one signature', filePath);
  }

  const rawProvenance = values.has('provenance') ? values.get('provenance') : [];
  const provenance = requireArray(rawProvenance, 'provenance', filePath).map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      fail('provenance[]', 'must be an object', filePath);
    }
    const record = entry as Record<string, unknown>;
    const sessionId = requireString(record.session_id, 'provenance[].session_id', filePath);
    const eventSeq = record.event_seq;
    if (typeof eventSeq !== 'number' || !Number.isSafeInteger(eventSeq) || eventSeq < 0) {
      fail('provenance[].event_seq', 'must be a non-negative integer', filePath);
    }
    const speaker = requireString(record.speaker, 'provenance[].speaker', filePath);
    if (!SPEAKERS.has(speaker)) fail('provenance[].speaker', 'must be user, assistant, tool or system', filePath);
    const quote = requireString(record.quote, 'provenance[].quote', filePath);
    if ([...quote].length > 160) fail('provenance[].quote', 'must be at most 160 characters', filePath);
    const eventSha = requireString(record.event_sha256, 'provenance[].event_sha256', filePath);
    if (!SHA256.test(eventSha)) fail('provenance[].event_sha256', 'must be 64 lowercase hex characters', filePath);
    return { session_id: sessionId, event_seq: eventSeq, speaker, quote, event_sha256: eventSha } as ProvenanceEntry;
  });
  if (author === 'agent' && provenance.length === 0) {
    fail('provenance', 'an agent-authored memory needs at least one provenance entry', filePath);
  }

  if ([...body].length > limits.bodyChars) {
    fail('body', `exceeds limits.body_chars (${limits.bodyChars})`, filePath);
  }
  if ([...normalized].length > limits.maxRecordChars) {
    fail('file', `exceeds storage.max_record_chars (${limits.maxRecordChars})`, filePath);
  }

  return {
    id,
    mem_schema: memSchema,
    kind: kind as Kind,
    scope: 'local',
    project,
    tags,
    relations,
    source,
    abstract,
    created_at: createdAt,
    valid_from: validFrom,
    valid_until: validUntil,
    supersedes,
    author,
    evidence_level: evidenceLevel as EvidenceLevel,
    error_signatures: errorSignatures,
    provenance,
    body,
    file_path: filePath,
    content_hash: hashContent(normalized),
  };
}

/** Serialize in the fixed field order so diffs stay stable. */
export function serializeMemory(doc: Omit<MemoryDoc, 'file_path' | 'content_hash'>): string {
  const values: Record<string, unknown> = {
    id: doc.id,
    mem_schema: doc.mem_schema,
    kind: doc.kind,
    scope: doc.scope,
    project: doc.project ?? null,
    tags: doc.tags ?? [],
    relations: doc.relations ?? [],
    source: doc.source ?? null,
    abstract: doc.abstract,
    created_at: doc.created_at,
    valid_from: doc.valid_from,
    valid_until: doc.valid_until,
    supersedes: doc.supersedes,
    author: doc.author,
    evidence_level: doc.evidence_level,
    error_signatures: doc.error_signatures,
    provenance: doc.provenance,
  };
  const lines = FIELD_ORDER.map((field) => `${field}: ${JSON.stringify(values[field])}`);
  const body = doc.body.endsWith('\n') ? doc.body : `${doc.body}\n`;
  return `---\n${lines.join('\n')}\n---\n${body}`;
}
