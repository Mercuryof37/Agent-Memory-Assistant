import { createHash } from 'node:crypto';
import type { ProvenanceEntry } from './model/types.ts';

/**
 * Trusted source binding (plan v1.3 §5.3). The model only supplies
 * `{event_seq, quote}`; the adapter resolves the real event and fills
 * `session_id` / `speaker` / `event_sha256`. A quote that is not a substring of
 * the resolved event, a missing event, or an assistant message used as evidence
 * is rejected.
 */

export interface EvidenceEvent {
  readonly seq: number;
  readonly speaker: 'user' | 'assistant' | 'tool' | 'system';
  readonly text: string;
}

export class EvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceError';
  }
}

export interface BindEvidenceInput {
  readonly sessionId: string;
  readonly eventSeq: number;
  readonly quote: string;
  readonly lookup: (seq: number) => EvidenceEvent | undefined;
  /** Optional caller-supplied hash; must match the resolved event text. */
  readonly expectedSha256?: string;
}

export function bindEvidence(input: BindEvidenceInput): ProvenanceEntry {
  const event = input.lookup(input.eventSeq);
  if (event === undefined) throw new EvidenceError(`event ${input.eventSeq} does not exist in this session`);
  if (event.seq !== input.eventSeq) throw new EvidenceError('event sequence mismatch');
  if (event.speaker === 'assistant') {
    throw new EvidenceError('a model message cannot be its own evidence');
  }
  if (input.quote.length === 0 || [...input.quote].length > 160) {
    throw new EvidenceError('quote must be 1..160 characters');
  }
  if (!event.text.includes(input.quote)) {
    throw new EvidenceError('quote is not a substring of the referenced event');
  }
  const sha256 = createHash('sha256').update(event.text, 'utf8').digest('hex');
  if (input.expectedSha256 !== undefined && input.expectedSha256 !== sha256) {
    throw new EvidenceError('event hash does not match the resolved event');
  }
  return {
    session_id: input.sessionId,
    event_seq: input.eventSeq,
    speaker: event.speaker,
    quote: input.quote,
    event_sha256: sha256,
  };
}
