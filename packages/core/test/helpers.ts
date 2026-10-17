import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StartupError, StartupFailureCode } from '../src/errors.ts';
import { ConfigError } from '../src/errors.ts';
import assert from 'node:assert/strict';

/** A throwaway home directory. Tests never touch the real store. */
export function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'agent-memory-test-'));
}

export function cleanupHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

export function expectStartupError(fn: () => unknown, code: StartupFailureCode): StartupError {
  try {
    fn();
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as StartupError).code === code) {
      return error as StartupError;
    }
    throw error;
  }
  assert.fail(`expected a startup failure with code ${code}`);
}

export function expectConfigError(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  assert.fail('expected a ConfigError');
}
