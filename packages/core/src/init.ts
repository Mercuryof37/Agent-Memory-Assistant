import { existsSync } from 'node:fs';
import { CONFIG_TEMPLATE } from './config/config.ts';
import { ensureDir, writeFileAtomic } from './fs/atomic.ts';
import { assertSafeHome, layoutDirectories, memoryPaths } from './paths.ts';
import { POLICY_TEMPLATE, sealIfNeeded } from './policy/policy.ts';
import { ensureProjectsFile } from './projects/projects.ts';
import { ensureCheckpointKey } from './journal/checkpoint.ts';

export interface InitResult {
  readonly home: string;
  readonly createdDirs: readonly string[];
  readonly createdFiles: readonly string[];
  readonly keptFiles: readonly string[];
  readonly sealSha256: string;
}

/**
 * Create the store skeleton.
 *
 * Existing files are kept, never overwritten: `mem init` is safe to re-run and
 * must not quietly discard a human's edits. Content files (SOUL/USER/RULES/
 * MEMORY) are created by the stage that owns their format.
 */
export function initStore(options: { home: string; now?: Date }): InitResult {
  assertSafeHome(options.home);
  const paths = memoryPaths(options.home);
  const createdDirs: string[] = [];
  for (const dir of layoutDirectories(paths)) {
    if (!existsSync(dir)) createdDirs.push(dir);
    ensureDir(dir);
  }

  const createdFiles: string[] = [];
  const keptFiles: string[] = [];

  if (existsSync(paths.configFile)) keptFiles.push(paths.configFile);
  else {
    writeFileAtomic(paths.configFile, CONFIG_TEMPLATE);
    createdFiles.push(paths.configFile);
  }

  if (existsSync(paths.policyFile)) keptFiles.push(paths.policyFile);
  else {
    writeFileAtomic(paths.policyFile, POLICY_TEMPLATE);
    createdFiles.push(paths.policyFile);
  }

  if (!ensureProjectsFile(paths.home)) keptFiles.push(paths.projectsFile);
  else createdFiles.push(paths.projectsFile);

  const hadCheckpointKey = existsSync(paths.checkpointKeyFile);
  ensureCheckpointKey(paths.home);
  if (hadCheckpointKey) keptFiles.push(paths.checkpointKeyFile);
  else createdFiles.push(paths.checkpointKeyFile);

  const hadSeal = existsSync(paths.sealFile);
  const seal = sealIfNeeded({ home: paths.home, ...(options.now === undefined ? {} : { now: options.now }) });
  if (hadSeal) keptFiles.push(paths.sealFile);
  else createdFiles.push(paths.sealFile);

  return { home: paths.home, createdDirs, createdFiles, keptFiles, sealSha256: seal.sha256 };
}
