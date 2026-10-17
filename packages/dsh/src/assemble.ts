import type { Config } from '../../core/src/config/config.ts';
import type { Policy } from '../../core/src/policy/policy.ts';
import type { MemoryDoc } from '../../core/src/model/types.ts';

/**
 * DSH adapter seam for injection (plan v1.3 §3.2).
 *
 * The plugin bundle must stay dependency-free (S3.6 bundle contract), so it can
 * import types but not the core file-I/O implementation: the host-side code that
 * can read the store passes the assembled text in, and this module only shapes
 * it into a `systemPrompt.section` definition.
 */

export interface AssembleDeps {
  readonly home: string;
  readonly config: Config;
  readonly policy: Policy;
  readonly source: { active(date?: string): readonly MemoryDoc[] };
  readonly sessionId: string;
  readonly measure?: (text: string) => number;
}

export interface MemorySection {
  readonly name: 'agent-memory';
  readonly order: number;
  readonly text: string;
  readonly interpolate: false;
}

export function memorySection(text: string, order = 100): MemorySection {
  return { name: 'agent-memory', order, text, interpolate: false };
}
