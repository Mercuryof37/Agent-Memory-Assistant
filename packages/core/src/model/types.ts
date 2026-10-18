/**
 * Frozen data shapes for v1.3 (plan appendix F).
 *
 * Type-only module: no runtime values, so it stays usable from both the store
 * and the adapter without pulling implementations into either.
 */

export type Kind = 'fact' | 'pitfall' | 'exp';
export type EvidenceLevel = 'user_explicit' | 'user_confirmed' | 'observed' | 'inferred';
export type MemoryId = string; // mem-YYYYMMDD-8hex
export type RelationType = 'relates_to' | 'derived_from';

export interface MemoryRelation {
  readonly type: RelationType;
  readonly target: MemoryId;
}

export interface MemorySource {
  readonly type: string;
  readonly id: string;
}

export interface ProvenanceEntry {
  readonly session_id: string;
  readonly event_seq: number;
  readonly speaker: 'user' | 'assistant' | 'tool' | 'system';
  readonly quote: string; // <= 160
  readonly event_sha256: string;
}

export interface MemoryDoc {
  readonly id: MemoryId;
  readonly mem_schema: 1 | 2;
  readonly kind: Kind;
  readonly scope: 'local';
  readonly project?: string | null;
  readonly tags?: readonly string[];
  readonly relations?: readonly MemoryRelation[];
  readonly source?: MemorySource | null;
  readonly abstract: string;
  readonly created_at: string;
  readonly valid_from: string;
  readonly valid_until: string | null;
  readonly supersedes: readonly MemoryId[];
  readonly author: 'agent' | 'human';
  readonly evidence_level: EvidenceLevel;
  readonly error_signatures: readonly string[];
  readonly provenance: readonly ProvenanceEntry[];
  readonly body: string;
  readonly file_path: string;
  readonly content_hash: string;
}

export interface RecordInput {
  readonly kind: Kind;
  readonly abstract: string;
  readonly body: string;
  readonly project?: string | null;
  readonly tags?: readonly string[];
  readonly relations?: readonly MemoryRelation[];
  readonly source?: MemorySource;
  readonly valid_from?: string;
  readonly error_signatures?: readonly string[];
  readonly evidence_level: Exclude<EvidenceLevel, 'inferred'>;
  readonly evidence?: readonly { readonly event_seq: number; readonly quote: string }[];
}

/**
 * A supersede replacement may carry provenance bound at propose time (verified
 * against the proposing session). The evidence survives into the record on
 * accept, so "证据可核验" is not lost at the pending-file boundary.
 */
export interface ProposalReplacement extends RecordInput {
  readonly provenance?: readonly ProvenanceEntry[];
}

export type ProposalInput =
  | {
      readonly op: 'supersede';
      readonly targets: readonly MemoryId[];
      readonly base_hashes: readonly string[];
      readonly replacements: readonly ProposalReplacement[];
      readonly reason?: string;
    }
  | {
      readonly op: 'create';
      readonly replacements: readonly ProposalReplacement[];
      readonly reason?: string;
    }
  | {
      readonly op: 'delete';
      readonly target: MemoryId;
      readonly base_hash: string;
      readonly reason: string;
    };

export interface WriteResult {
  readonly id: MemoryId;
  readonly content_hash: string;
  readonly deduplicated: boolean;
  readonly warnings: readonly string[];
}

export interface RecallHit {
  readonly id: MemoryId;
  readonly kind: Kind;
  readonly abstract: string;
  readonly score: number;
  readonly valid_from: string;
  readonly valid_until: string | null;
  readonly provenance_verifiable: boolean;
}

export interface RecallResult {
  readonly hits: readonly RecallHit[];
  readonly warnings: readonly string[];
}

export interface Stats {
  readonly active: number;
  readonly total_files: number;
  readonly quarantined: number;
  readonly deleted: number;
  readonly pending_proposals: number;
  readonly journal_head: { readonly seq: number; readonly hash: string } | null;
  readonly journal_consistent: boolean;
}

export interface JournalEntry {
  readonly seq: number;
  readonly prev: string;
  readonly at: string;
  readonly op: 'record' | 'adopt' | 'delete' | 'decide' | 'audit';
  readonly op_id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface JournalIssue {
  readonly kind: 'chain' | 'seq' | 'parse' | 'duplicate-op';
  readonly message: string;
  readonly seq?: number;
}

export interface RebuildReport {
  readonly records: number;
  readonly files: number;
  readonly quarantined: readonly string[];
  readonly journal_head: { readonly seq: number; readonly hash: string } | null;
  readonly journal_consistent: boolean;
  readonly rebuilt_index: boolean;
  readonly rebuilt_catalog: boolean;
}
