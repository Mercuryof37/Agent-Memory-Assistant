import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { writeFileAtomic } from '../fs/atomic.ts';
import { memoryPaths } from '../paths.ts';

/**
 * Sidecar vector cache (V4.0-S2b).
 *
 * The plugin never runs ONNX itself. A user-installed vectorizer command reads
 * `{ texts: string[] }` from an input file and writes `{ vectors: number[][] }`
 * to an output file:
 *
 *   node my-vectorizer.mjs <input.json> <output.json>
 *
 * `mem embed --apply` fills the cache; `recallAsync` asks the same command for
 * the query vector. File IPC (not stdio pipes) keeps it usable under sandboxes
 * that refuse piped child processes.
 */

export interface EmbeddingCache {
  readonly schema: 1;
  readonly provider: string;
  readonly dimensions: number;
  readonly generated_at: string;
  readonly docs: Readonly<Record<string, readonly number[]>>;
}

const CACHE_SCHEMA = 1;

export function embeddingsFile(home: string): string {
  return join(memoryPaths(home).indexDir, 'embeddings.json');
}

export function readEmbeddingCache(home: string): EmbeddingCache | undefined {
  try {
    const parsed = JSON.parse(readFileSync(embeddingsFile(home), 'utf8')) as Partial<EmbeddingCache>;
    if (parsed.schema !== CACHE_SCHEMA) return undefined;
    if (typeof parsed.provider !== 'string' || typeof parsed.dimensions !== 'number') return undefined;
    if (typeof parsed.generated_at !== 'string' || typeof parsed.docs !== 'object' || parsed.docs === null) {
      return undefined;
    }
    return parsed as EmbeddingCache;
  } catch {
    return undefined;
  }
}

export function writeEmbeddingCache(home: string, cache: EmbeddingCache): void {
  writeFileAtomic(embeddingsFile(home), `${JSON.stringify(cache)}\n`);
}

export interface VectorizerResult {
  readonly vectors: readonly (readonly number[])[];
  readonly dimensions: number;
}

export function vectorizerCommand(): string | undefined {
  const command = process.env.AGENT_MEMORY_VECTORIZER?.trim();
  return command === undefined || command === '' ? undefined : command;
}

/** Run the user's vectorizer over a batch of texts. */
export async function embedTexts(command: string, texts: readonly string[]): Promise<VectorizerResult> {
  const dir = mkdtempSync(join(tmpdir(), 'agent-memory-embed-'));
  const inputPath = join(dir, 'input.json');
  const outputPath = join(dir, 'output.json');
  try {
    writeFileSync(inputPath, JSON.stringify({ texts }));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, [inputPath, outputPath], {
        stdio: 'ignore',
        shell: true,
        windowsHide: true,
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`vectorizer exited with ${code ?? 'no code'}`));
      });
    });
    const parsed = JSON.parse(readFileSync(outputPath, 'utf8')) as { vectors?: unknown };
    if (!Array.isArray(parsed.vectors) || parsed.vectors.length !== texts.length) {
      throw new Error('vectorizer output must contain one vector per text');
    }
    let dimensions = 0;
    for (const vector of parsed.vectors) {
      if (!Array.isArray(vector) || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
        throw new Error('vectorizer vectors must be arrays of finite numbers');
      }
      if (dimensions === 0) dimensions = vector.length;
      if (vector.length !== dimensions) throw new Error('vectorizer vectors have inconsistent dimensions');
    }
    return { vectors: parsed.vectors as number[][], dimensions };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
