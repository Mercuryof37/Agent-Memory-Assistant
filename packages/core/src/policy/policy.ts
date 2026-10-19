import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isRawTable, stripBom, type RawTable } from '../config/toml.ts';
import { schemaKeys, validateAgainstSchema, type TableSpec } from '../config/schema.ts';
import { StartupError, type ConfigProblem } from '../errors.ts';
import { writeFileAtomic } from '../fs/atomic.ts';
import { hashContent } from '../model/frontmatter.ts';
import { memoryPaths, canonicalizeHome } from '../paths.ts';

/**
 * policy.json: the attack surface that must not be editable by the agent.
 *
 * It is sealed with a SHA-256 of its bytes. Every startup recomputes the hash;
 * any mismatch aborts startup instead of loading a relaxed policy (`06` L3).
 * Re-sealing is a human action: `mem policy seal --accept`.
 *
 * The optional `sealed_files` hashes make the human-maintained SOUL/USER/RULES
 * editable only through a deliberate re-seal: an empty string skips a file.
 */

export interface Policy {
  readonly version: number;
  readonly capacity: {
    readonly max_records: number;
    readonly max_record_chars: number;
  };
  readonly scan: {
    readonly invisible_unicode: 'reject';
    readonly credentials: 'reject';
    readonly injection: 'reject' | 'flag';
    readonly private_tag: 'reject' | 'confirm';
  };
  readonly rules: {
    readonly agent_writable: false;
  };
  readonly sealed_files: {
    readonly soul: string;
    readonly user: string;
    readonly rules: string;
  };
}

export const policySchema: TableSpec = {
  version: { type: 'int', default: 2, min: 1, max: 2 },
  capacity: {
    max_records: { type: 'int', default: 1000, min: 1, max: 100_000 },
    max_record_chars: { type: 'int', default: 10_000, min: 100, max: 200_000 },
  },
  scan: {
    invisible_unicode: { type: 'enum', values: ['reject'], default: 'reject' },
    credentials: { type: 'enum', values: ['reject'], default: 'reject' },
    injection: { type: 'enum', values: ['reject', 'flag'], default: 'reject' },
    private_tag: { type: 'enum', values: ['reject', 'confirm'], default: 'confirm' },
  },
  rules: {
    agent_writable: { type: 'bool', default: false },
  },
  sealed_files: {
    soul: { type: 'string', default: '' },
    user: { type: 'string', default: '' },
    rules: { type: 'string', default: '' },
  },
};

export const POLICY_TEMPLATE = `{
  "version": 2,
  "capacity": {
    "max_records": 1000,
    "max_record_chars": 10000
  },
  "scan": {
    "invisible_unicode": "reject",
    "credentials": "reject",
    "injection": "reject",
    "private_tag": "confirm"
  },
  "rules": {
    "agent_writable": false
  },
  "sealed_files": {
    "soul": "",
    "user": "",
    "rules": ""
  }
}
`;

export interface SealRecord {
  readonly policy: string;
  readonly sha256: string;
  readonly sealed_at: string;
}

export interface LoadedPolicy {
  readonly policy: Policy;
  readonly policyPath: string;
  readonly sealPath: string;
  readonly sha256: string;
  readonly sealedAt: string;
}

export function policyKeys(): string[] {
  return schemaKeys(policySchema);
}

export function defaultPolicy(): Policy {
  return parsePolicyText(POLICY_TEMPLATE).policy;
}

export function hashBytes(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function parsePolicyText(text: string): { policy: Policy; problems: ConfigProblem[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      policy: {} as Policy,
      problems: [{ key: '<json>', message: `policy is not valid JSON: ${message}` }],
    };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      policy: {} as Policy,
      problems: [{ key: '<root>', message: 'policy must be a JSON object' }],
    };
  }
  const { values, problems: schemaProblems } = validateAgainstSchema(policySchema, raw as RawTable);
  const problems = [...schemaProblems];
  const policy = values as unknown as Policy;
  const rules = values.rules;
  if (isRawTable(rules) && rules.agent_writable === true) {
    problems.push({
      key: 'rules.agent_writable',
      message: '"rules.agent_writable" must stay false in V1.0: the agent has no channel to RULES.md',
    });
  }
  const sealed = values.sealed_files;
  if (isRawTable(sealed)) {
    for (const key of ['soul', 'user', 'rules'] as const) {
      const value = sealed[key];
      if (typeof value === 'string' && value !== '' && !/^[0-9a-f]{64}$/.test(value)) {
        problems.push({
          key: `sealed_files.${key}`,
          message: `"sealed_files.${key}" must be empty or a 64-character lowercase hex hash`,
        });
      }
    }
  }
  return { policy, problems };
}

export interface SealedFileHashes {
  readonly soul: string;
  readonly user: string;
  readonly rules: string;
}

/**
 * Normalized hashes of the human-maintained files. A missing file seals as an
 * empty string, which means "skip this file".
 */
export function computeSealedFiles(home: string): SealedFileHashes {
  const paths = memoryPaths(home);
  const hashOf = (file: string): string => {
    try {
      return existsSync(file) ? hashContent(readFileSync(file, 'utf8')) : '';
    } catch {
      return '';
    }
  };
  return { soul: hashOf(paths.soulFile), user: hashOf(paths.userFile), rules: hashOf(paths.rulesFile) };
}

/**
 * Startup check for the sealed human files. Editing SOUL/USER/RULES without a
 * deliberate re-seal stops startup with the file named.
 */
export function verifySealedFiles(options: { home: string; policy: Policy }): void {
  const paths = memoryPaths(options.home);
  const targets: ReadonlyArray<readonly [keyof SealedFileHashes, string, string]> = [
    ['soul', paths.soulFile, 'SOUL.md'],
    ['user', paths.userFile, 'USER.md'],
    ['rules', paths.rulesFile, 'RULES.md'],
  ];
  for (const [key, file, name] of targets) {
    const expected = options.policy.sealed_files[key];
    if (expected === '') continue;
    const actual = existsSync(file) ? hashContent(readFileSync(file, 'utf8')) : '';
    if (actual !== expected) {
      const homeArg = /\s/.test(options.home) ? `"${options.home}"` : options.home;
      throw new StartupError('SEALED_FILE_MISMATCH', `${name} does not match its sealed hash`, {
        sourcePath: file,
        details: [`sealed sha256 ${expected}`, `actual sha256 ${actual === '' ? '(missing)' : actual}`],
        fixCommand: `mem policy seal --home ${homeArg} --accept`,
        hint: `编辑 ${name} 后必须重新封存；也可以在聊天框运行 /mem seal --accept`,
      });
    }
  }
}

export function loadPolicy(options: { home: string }): LoadedPolicy {
  const paths = memoryPaths(options.home);
  const policyText = readFileText(paths.policyFile, {
    code: 'POLICY_MISSING',
    message: 'policy.json is missing from the store',
    hint: 'run `mem init` to create the store, then seal the policy',
  });
  const sealText = readFileText(paths.sealFile, {
    code: 'POLICY_MISSING',
    message: 'policy.json is not sealed',
    hint: 'a human must review it and run `mem policy seal --accept`',
  });

  const seal = parseSeal(sealText, paths.sealFile);
  const sha256 = hashBytes(policyText);
  if (seal.sha256 !== sha256) {
    throw new StartupError('POLICY_MISMATCH', 'policy.json does not match its sealed hash', {
      sourcePath: paths.policyFile,
      details: [`sealed sha256 ${seal.sha256}`, `actual sha256 ${sha256}`],
      hint: 'the policy is immutable at runtime; after a deliberate human edit run `mem policy seal --accept`',
    });
  }

  const { policy, problems } = parsePolicyText(policyText);
  if (problems.length > 0) throw policyProblems(paths.policyFile, problems);

  return { policy, sha256, sealedAt: seal.sealed_at, policyPath: paths.policyFile, sealPath: paths.sealFile };
}

export interface SealResult {
  readonly sealPath: string;
  readonly sha256: string;
  /** Hash that was sealed before this call, if any. */
  readonly previousSha256: string | null;
  /** Normalized hashes of SOUL/USER/RULES at the moment of sealing. */
  readonly sealedFiles: SealedFileHashes;
}

/**
 * Re-seal the policy. Requires `accept === true`, which only the CLI passes
 * after a human typed the flag; nothing in the agent's tool surface can reach
 * this function.
 */
export function sealPolicy(options: {
  home: string;
  accept: boolean;
  now?: Date;
  /** Seal USER.md too. Default false: the agent may propose USER edits. */
  sealUser?: boolean;
  allowJunction?: boolean;
}): SealResult {
  const home = canonicalizeHome(options.home, { allowJunction: options.allowJunction === true });
  const paths = memoryPaths(home);
  if (!options.accept) {
    throw new StartupError('SEAL_REFUSED', 'refusing to re-seal policy.json without explicit confirmation', {
      sourcePath: paths.policyFile,
      hint: 'review the file, then run `mem policy seal --accept`; the agent has no path to this action',
    });
  }

  const policyText = readFileText(paths.policyFile, {
    code: 'POLICY_MISSING',
    message: 'policy.json is missing from the store',
    hint: 'run `mem init` first',
  });
  const { policy, problems } = parsePolicyText(policyText);
  if (problems.length > 0) throw policyProblems(paths.policyFile, problems);

  const computed = computeSealedFiles(home);
  const sealedFiles: SealedFileHashes = {
    soul: computed.soul,
    user: options.sealUser === true ? computed.user : '',
    rules: computed.rules,
  };
  const nextText = `${JSON.stringify({ ...policy, sealed_files: sealedFiles }, null, 2)}\n`;
  writeFileAtomic(paths.policyFile, nextText);

  const previous = tryReadSeal(paths.sealFile);
  const sha256 = hashBytes(nextText);
  writeSeal(paths.sealFile, { policy: 'policy.json', sha256, sealed_at: (options.now ?? new Date()).toISOString() });
  return { sealPath: paths.sealFile, sha256, previousSha256: previous?.sha256 ?? null, sealedFiles };
}

/**
 * Used by `mem init`: seal when unsealed, accept when already sealed and
 * matching, refuse when the file changed under an existing seal.
 */
export function sealIfNeeded(options: { home: string; now?: Date }): SealResult {
  const paths = memoryPaths(options.home);
  const policyText = readFileText(paths.policyFile, {
    code: 'POLICY_MISSING',
    message: 'policy.json is missing from the store',
    hint: 'run `mem init` first',
  });
  const { problems } = parsePolicyText(policyText);
  if (problems.length > 0) throw policyProblems(paths.policyFile, problems);

  const sha256 = hashBytes(policyText);
  const sealedFiles = computeSealedFiles(options.home);
  const existing = tryReadSeal(paths.sealFile);
  if (existing !== null) {
    if (existing.sha256 !== sha256) {
      throw new StartupError('POLICY_MISMATCH', 'policy.json changed after it was sealed', {
        sourcePath: paths.policyFile,
        details: [`sealed sha256 ${existing.sha256}`, `actual sha256 ${sha256}`],
        hint: 'verify the change, then run `mem policy seal --accept`',
      });
    }
    return { sealPath: paths.sealFile, sha256, previousSha256: existing.sha256, sealedFiles };
  }
  writeSeal(paths.sealFile, { policy: 'policy.json', sha256, sealed_at: (options.now ?? new Date()).toISOString() });
  return { sealPath: paths.sealFile, sha256, previousSha256: null, sealedFiles };
}

function writeSeal(sealPath: string, record: SealRecord): void {
  writeFileAtomic(sealPath, `${JSON.stringify(record, null, 2)}\n`);
}

function parseSeal(text: string, sealPath: string): SealRecord {
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StartupError('POLICY_INVALID', 'the policy seal file is not valid JSON', {
      sourcePath: sealPath,
      details: [message],
      hint: 'run `mem policy seal --accept` to write a fresh seal',
    });
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new StartupError('POLICY_INVALID', 'the policy seal file must be a JSON object', {
      sourcePath: sealPath,
    });
  }
  const record = raw as Record<string, unknown>;
  const allowed = new Set(['policy', 'sha256', 'sealed_at']);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new StartupError('POLICY_INVALID', 'the policy seal file has unknown keys', {
      sourcePath: sealPath,
      details: unknown.map((key) => `unknown key "${key}"`),
    });
  }
  const sha256 = record.sha256;
  if (typeof record.policy !== 'string' || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw new StartupError('POLICY_INVALID', 'the policy seal file is malformed', {
      sourcePath: sealPath,
      details: ['expected { "policy": string, "sha256": <64 hex chars>, "sealed_at": string }'],
    });
  }
  const sealedAt = typeof record.sealed_at === 'string' ? record.sealed_at : '';
  return { policy: record.policy, sha256, sealed_at: sealedAt };
}

function tryReadSeal(sealPath: string): SealRecord | null {
  let text: string;
  try {
    text = readFileSync(sealPath, 'utf8');
  } catch {
    return null;
  }
  return parseSeal(text, sealPath);
}

function readFileText(filePath: string, missing: { code: 'POLICY_MISSING'; message: string; hint: string }): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new StartupError(missing.code, missing.message, {
        sourcePath: filePath,
        hint: missing.hint,
      });
    }
    throw new StartupError('POLICY_INVALID', 'the policy file cannot be read', {
      sourcePath: filePath,
      details: [error instanceof Error ? error.message : String(error)],
    });
  }
}

function policyProblems(sourcePath: string, problems: readonly ConfigProblem[]): StartupError {
  return new StartupError('POLICY_INVALID', `policy rejected (${problems.length} problem${problems.length === 1 ? '' : 's'})`, {
    sourcePath,
    keys: problems.map((problem) => problem.key),
    details: problems.map((problem) => problem.message),
    hint: 'fix policy.json, then have a human run `mem policy seal --accept`',
  });
}
