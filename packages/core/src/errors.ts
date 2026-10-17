/**
 * Startup failures are loud on purpose.
 *
 * The reference failure this guards against is Hermes' silent breakage: a
 * config parse error swallowed by `except: pass` left the whole memory
 * subsystem dead with no message (see docs/research/06 §L3). Nothing in this
 * package may degrade silently at startup.
 */

export type StartupFailureCode =
  | 'CONFIG_INVALID'
  | 'CONFIG_UNREADABLE'
  | 'POLICY_MISSING'
  | 'POLICY_INVALID'
  | 'POLICY_MISMATCH'
  | 'SEALED_FILE_MISMATCH'
  | 'HOME_INVALID'
  | 'SEAL_REFUSED';

export interface StartupFailureInit {
  /** Ordered, printable detail lines (each already formatted). */
  readonly details?: readonly string[];
  /** One-line next step for a human. */
  readonly hint?: string;
  /** Exact command that repairs this failure; printed highlighted by `format()`. */
  readonly fixCommand?: string;
  /** Machine-readable offending keys, for tests and tooling. */
  readonly keys?: readonly string[];
  /** File the failure came from, when there is one. */
  readonly sourcePath?: string;
}

export class StartupError extends Error {
  readonly code: StartupFailureCode;
  readonly details: readonly string[];
  readonly hint: string | undefined;
  readonly fixCommand: string | undefined;
  readonly keys: readonly string[];
  readonly sourcePath: string | undefined;

  constructor(code: StartupFailureCode, message: string, init: StartupFailureInit = {}) {
    super(message);
    this.name = 'StartupError';
    this.code = code;
    this.details = init.details ?? [];
    this.hint = init.hint;
    this.fixCommand = init.fixCommand;
    this.keys = init.keys ?? [];
    this.sourcePath = init.sourcePath;
  }

  /** Multi-line text for a terminal; never truncated, never prettified away. */
  format(): string {
    const lines = [`Agent Memory startup failed [${this.code}]: ${this.message}`];
    if (this.sourcePath !== undefined) lines.push(`  file: ${this.sourcePath}`);
    for (const detail of this.details) lines.push(`  - ${detail}`);
    if (this.fixCommand !== undefined) {
      // Deliberately loud: the human must see the exact repair command even when
      // this text is shown inside a desktop card or a chat transcript.
      lines.push('', '  ================  REQUIRED ACTION  ================');
      lines.push(`  >>> RUN THIS COMMAND:  ${this.fixCommand}`);
      lines.push('  ===================================================');
    }
    if (this.hint !== undefined) lines.push(`  hint: ${this.hint}`);
    return lines.join('\n');
  }
}

export class ConfigError extends StartupError {
  readonly problems: readonly ConfigProblem[];

  constructor(sourcePath: string, problems: readonly ConfigProblem[], hint?: string) {
    const sorted = [...problems].sort((a, b) => a.key.localeCompare(b.key));
    const count = sorted.length;
    super(
      'CONFIG_INVALID',
      `configuration rejected (${count} problem${count === 1 ? '' : 's'})`,
      {
        sourcePath,
        keys: sorted.map((problem) => problem.key),
        details: sorted.map(formatProblem),
        ...(hint === undefined ? {} : { hint }),
      },
    );
    this.name = 'ConfigError';
    this.problems = sorted;
  }
}

export interface ConfigProblem {
  readonly key: string;
  readonly message: string;
  readonly line?: number;
}

export function formatProblem(problem: ConfigProblem): string {
  const prefix = problem.line === undefined ? '' : `line ${problem.line} | `;
  return `${prefix}${problem.message}`;
}
