import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { StartupError } from './errors.ts';

/**
 * Where the store lives, and nothing else.
 *
 * The data directory is meant to sit outside the agent's tool sandbox (`06`
 * §L0): under DSH's `workspace-write` policy, tool writes outside the workspace
 * are refused. That is a tool-layer boundary, not OS-level isolation — the host
 * process can still read the path, and S0 has to confirm the boundary for the
 * pinned DSH version. The path here is host-side truth, never model input.
 */

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Reject paths a Windows filesystem cannot represent or that name devices. */
export function assertSafeHome(home: string): void {
  if (!isAbsolute(home)) {
    throw new StartupError('HOME_INVALID', 'the store path must be absolute', {
      sourcePath: home,
      hint: 'pass --home with an absolute path, or set AGENT_MEMORY_HOME',
    });
  }
  const segments = home.split(/[\\/]+/).filter((segment) => segment !== '');
  const dataSegments = segments[0]?.endsWith(':') === true ? segments.slice(1) : segments;
  for (const segment of dataSegments) {
    if (WINDOWS_RESERVED.test(segment)) {
      throw new StartupError('HOME_INVALID', `the store path contains a reserved Windows name: ${segment}`, {
        sourcePath: home,
        hint: 'choose a different --home',
      });
    }
    if (segment.includes(':')) {
      throw new StartupError('HOME_INVALID', `the store path contains an invalid segment: ${segment}`, {
        sourcePath: home,
        hint: 'colons are only allowed in the drive prefix',
      });
    }
  }
}

export interface EnvLike {
  readonly [key: string]: string | undefined;
}

/**
 * Follow a store path through a junction or symlink, but only on purpose.
 *
 * A linked store directory silently relocates every write, backup and export;
 * DSH keeps the data directory outside the tool sandbox, so "where the store
 * really is" must be an explicit choice. The check covers the two segments a
 * human picks - the store directory itself and its immediate parent. Higher
 * ancestors (a redirected `C:\Users`, for example) are left alone: they are
 * machine layout, not the store.
 */
export function canonicalizeHome(home: string, options: { readonly allowJunction?: boolean } = {}): string {
  const homeRedirect = redirectOf(home);
  const parentRedirect = redirectOf(dirname(home));
  if (homeRedirect === null && parentRedirect === null) return home;
  const linked = homeRedirect !== null ? home : dirname(home);
  if (options.allowJunction !== true) {
    throw new StartupError('HOME_INVALID', `the store path goes through a junction or symlink: ${linked}`, {
      sourcePath: home,
      hint: 'pass --allow-junction (or set AGENT_MEMORY_ALLOW_JUNCTION=1) to use the canonical path',
    });
  }
  return homeRedirect ?? join(parentRedirect ?? dirname(home), basename(home));
}

/**
 * Where a path really points, or null when it points at itself.
 *
 * `lstat().isSymbolicLink()` is not enough on Windows: libuv reports junctions
 * as ordinary directories. Comparing the native real path with
 * `realpath(parent) + basename` detects junctions and symlinks alike, while a
 * plain directory (even one reached through an 8.3 short name) compares equal.
 */
function redirectOf(path: string): string | null {
  try {
    const real = realpathSync.native(path);
    const expected = join(realpathSync.native(dirname(path)), basename(path));
    return samePath(real, expected) ? null : real;
  } catch {
    return null;
  }
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export interface MemoryPaths {
  readonly home: string;
  readonly configFile: string;
  readonly projectsFile: string;
  readonly policyFile: string;
  readonly sealFile: string;
  readonly lockFile: string;
  readonly soulFile: string;
  readonly userFile: string;
  readonly rulesFile: string;
  readonly memoryIndexFile: string;
  readonly memoriesDir: string;
  readonly proposalsDir: string;
  readonly pendingDir: string;
  readonly indexDir: string;
  readonly manifestFile: string;
  readonly stateDir: string;
  readonly journalDir: string;
  readonly journalArchiveDir: string;
  readonly checkpointFile: string;
  readonly checkpointKeyFile: string;
  readonly txnDir: string;
  readonly snapshotsDir: string;
}

export function memoryPaths(home: string): MemoryPaths {
  return {
    home,
    configFile: join(home, 'config.toml'),
    projectsFile: join(home, 'projects.json'),
    policyFile: join(home, 'policy.json'),
    sealFile: join(home, '.state', 'policy.seal.json'),
    lockFile: join(home, '.state', 'lock'),
    soulFile: join(home, 'SOUL.md'),
    userFile: join(home, 'USER.md'),
    rulesFile: join(home, 'RULES.md'),
    memoryIndexFile: join(home, 'MEMORY.md'),
    memoriesDir: join(home, 'memories'),
    proposalsDir: join(home, 'proposals'),
    pendingDir: join(home, 'proposals', 'pending'),
    indexDir: join(home, '.index'),
    manifestFile: join(home, '.index', 'manifest.json'),
    stateDir: join(home, '.state'),
    journalDir: join(home, '.state', 'journal'),
    journalArchiveDir: join(home, '.state', 'journal', 'archive'),
    checkpointFile: join(home, '.state', 'checkpoint.json'),
    checkpointKeyFile: join(home, '.state', 'checkpoint.key'),
    txnDir: join(home, '.state', 'txn'),
    snapshotsDir: join(home, '.state', 'snapshots'),
  };
}

/** Directories `mem init` creates (v1.3 layout: one journal, no audit file). */
export function layoutDirectories(paths: MemoryPaths): string[] {
  return [
    paths.home,
    join(paths.memoriesDir, 'fact'),
    join(paths.memoriesDir, 'pitfall'),
    join(paths.memoriesDir, 'exp'),
    paths.proposalsDir,
    paths.pendingDir,
    paths.indexDir,
    paths.stateDir,
    paths.journalDir,
    paths.txnDir,
    paths.snapshotsDir,
  ];
}

/**
 * Resolution order: explicit option → AGENT_MEMORY_HOME → DSH_HOME/memory →
 * ~/.dsh/memory. Relative paths resolve against the working directory.
 */
export function resolveHome(options: { home?: string; env?: EnvLike; cwd?: string } = {}): string {
  const cwd = options.cwd ?? process.cwd();
  const explicit = options.home ?? options.env?.AGENT_MEMORY_HOME;
  if (explicit !== undefined && explicit.trim() !== '') {
    return isAbsolute(explicit) ? explicit : resolve(cwd, explicit);
  }
  const dshHome = options.env?.DSH_HOME;
  if (dshHome !== undefined && dshHome.trim() !== '') {
    return join(isAbsolute(dshHome) ? dshHome : resolve(cwd, dshHome), 'memory');
  }
  return join(homedir(), '.dsh', 'memory');
}
