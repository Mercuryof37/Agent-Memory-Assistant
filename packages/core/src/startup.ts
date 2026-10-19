import { existsSync, statSync } from 'node:fs';
import { loadConfig } from './config/load.ts';
import type { Config } from './config/config.ts';
import { ConfigError, StartupError, type ConfigProblem } from './errors.ts';
import { memoryPaths, assertSafeHome, canonicalizeHome, resolveHome, type EnvLike, type MemoryPaths } from './paths.ts';
import { loadPolicy, verifySealedFiles, type Policy } from './policy/policy.ts';

/**
 * The one startup path. Everything loud about configuration lives here:
 *
 * 1. the store must exist (missing store = loud error, not silent defaults);
 * 2. policy.json must match its seal (tampering = refusal to start);
 * 3. config.toml must validate (unknown keys are refused, named);
 * 4. config may tighten policy bounds, never widen them.
 */

export interface StartupOptions {
  readonly home?: string;
  readonly configPath?: string;
  readonly env?: EnvLike;
  readonly cwd?: string;
  /** Accept a store behind a junction/symlink and use its canonical path. */
  readonly allowJunction?: boolean;
}

export interface Runtime {
  readonly home: string;
  readonly paths: MemoryPaths;
  readonly config: Config;
  readonly policy: Policy;
  readonly configPath: string | null;
  readonly policyPath: string;
  readonly sealPath: string;
  readonly policySha256: string;
  readonly sealedAt: string;
  readonly warnings: readonly string[];
}

export function startup(options: StartupOptions = {}): Runtime {
  const env = options.env ?? process.env;
  const home = canonicalizeHome(
    resolveHome({
      home: options.home,
      env,
      cwd: options.cwd,
    }),
    { allowJunction: options.allowJunction === true || env.AGENT_MEMORY_ALLOW_JUNCTION === '1' },
  );

  assertSafeHome(home);

  let isDirectory = false;
  try {
    isDirectory = statSync(home).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw new StartupError('HOME_INVALID', 'the memory store does not exist', {
      sourcePath: home,
      hint: 'run `mem init` (or set AGENT_MEMORY_HOME / DSH_HOME) before starting',
    });
  }

  const loadedPolicy = loadPolicy({ home });
  verifySealedFiles({ home, policy: loadedPolicy.policy });
  const loadedConfig = loadConfig({
    home,
    configPath: options.configPath,
    env: options.env,
    cwd: options.cwd,
  });

  const paths = memoryPaths(home);
  const boundsProblems = checkPolicyBounds(loadedConfig.config, loadedPolicy.policy);
  if (boundsProblems.length > 0) {
    throw new ConfigError(
      loadedConfig.configPath ?? paths.configFile,
      boundsProblems,
      'config.toml may tighten policy.json, never widen it',
    );
  }

  const warnings = [...loadedConfig.warnings, ...missingContentWarnings(paths)];

  return {
    home,
    paths,
    config: loadedConfig.config,
    policy: loadedPolicy.policy,
    configPath: loadedConfig.configPath,
    policyPath: loadedPolicy.policyPath,
    sealPath: loadedPolicy.sealPath,
    policySha256: loadedPolicy.sha256,
    sealedAt: loadedPolicy.sealedAt,
    warnings,
  };
}

function checkPolicyBounds(config: Config, policy: Policy): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  if (config.storage.max_records > policy.capacity.max_records) {
    problems.push({
      key: 'storage.max_records',
      message: `"storage.max_records" (${config.storage.max_records}) exceeds policy.capacity.max_records (${policy.capacity.max_records})`,
    });
  }
  if (config.storage.max_record_chars > policy.capacity.max_record_chars) {
    problems.push({
      key: 'storage.max_record_chars',
      message: `"storage.max_record_chars" (${config.storage.max_record_chars}) exceeds policy.capacity.max_record_chars (${policy.capacity.max_record_chars})`,
    });
  }
  return problems;
}

/**
 * Missing content files are warnings, not failures: a fresh store legitimately
 * has no memories yet. Files that were expected but cannot be read are a
 * different matter and are handled by the store layer in S2.
 */
function missingContentWarnings(paths: MemoryPaths): string[] {
  const expected: ReadonlyArray<readonly [string, string]> = [
    [paths.soulFile, 'SOUL.md'],
    [paths.userFile, 'USER.md'],
    [paths.rulesFile, 'RULES.md'],
    [paths.memoryIndexFile, 'MEMORY.md'],
  ];
  return expected
    .filter(([filePath]) => !existsSync(filePath))
    .map(([, name]) => `${name} is not present yet; that injection section will be empty`);
}
