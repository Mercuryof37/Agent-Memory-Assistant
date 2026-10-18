import { existsSync, readFileSync } from 'node:fs';
import { writeFileAtomic } from '../fs/atomic.ts';
import { projectProblem, PROJECT_NAME_MAX } from '../model/metadata.ts';
import { memoryPaths } from '../paths.ts';

/**
 * User-created project registry (v1.4).
 *
 * Projects are labels, not folders: a memory points at a project name, and the
 * registry only decides which names the UI offers. Deleting a project therefore
 * never deletes memories; they simply stop matching a live project.
 *
 * The file is plain JSON at `<home>/projects.json` and is intentionally small:
 * `{ schema: 1, projects: [{ name, description, created_at, updated_at }] }`.
 */

export interface Project {
  readonly name: string;
  readonly description: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ProjectRegistry {
  readonly schema: 1;
  readonly projects: readonly Project[];
}

export class ProjectError extends Error {
  readonly code: 'INVALID' | 'EXISTS' | 'NOT_FOUND';
  constructor(code: ProjectError['code'], message: string) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
  }
}

const DESCRIPTION_MAX = 280;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function readRegistry(home: string): ProjectRegistry {
  const file = memoryPaths(home).projectsFile;
  if (!existsSync(file)) return { schema: 1, projects: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new ProjectError('INVALID', `projects.json is not valid JSON: ${file}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ProjectError('INVALID', 'projects.json must be an object');
  }
  const record = parsed as { schema?: unknown; projects?: unknown };
  if (record.schema !== 1) throw new ProjectError('INVALID', 'projects.json schema must be 1');
  if (!Array.isArray(record.projects)) throw new ProjectError('INVALID', 'projects.json projects must be an array');
  const seen = new Set<string>();
  const projects: Project[] = [];
  for (const raw of record.projects) {
    if (typeof raw !== 'object' || raw === null) throw new ProjectError('INVALID', 'each project must be an object');
    const entry = raw as { name?: unknown; description?: unknown; created_at?: unknown; updated_at?: unknown };
    const issue = projectProblem(entry.name);
    if (issue !== undefined) throw new ProjectError('INVALID', issue);
    if (typeof entry.description !== 'string' || [...entry.description].length > DESCRIPTION_MAX) {
      throw new ProjectError('INVALID', `project description must be a string up to ${DESCRIPTION_MAX} characters`);
    }
    if (typeof entry.created_at !== 'string' || !TIMESTAMP.test(entry.created_at)) {
      throw new ProjectError('INVALID', 'project created_at must be an ISO timestamp');
    }
    if (typeof entry.updated_at !== 'string' || !TIMESTAMP.test(entry.updated_at)) {
      throw new ProjectError('INVALID', 'project updated_at must be an ISO timestamp');
    }
    const name = entry.name as string;
    if (seen.has(name.toLocaleLowerCase())) throw new ProjectError('INVALID', `duplicate project name: ${name}`);
    seen.add(name.toLocaleLowerCase());
    projects.push({
      name,
      description: entry.description,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
    });
  }
  return { schema: 1, projects };
}

function writeRegistry(home: string, registry: ProjectRegistry): void {
  writeFileAtomic(memoryPaths(home).projectsFile, `${JSON.stringify(registry, null, 2)}\n`);
}

export function listProjects(home: string): readonly Project[] {
  return readRegistry(home).projects;
}

export function projectExists(home: string, name: string): boolean {
  const lower = name.toLocaleLowerCase();
  return readRegistry(home).projects.some((project) => project.name.toLocaleLowerCase() === lower);
}

export function createProject(options: {
  home: string;
  name: string;
  description?: string;
  now?: Date;
}): Project {
  const name = options.name.trim();
  const issue = projectProblem(name);
  if (issue !== undefined) throw new ProjectError('INVALID', issue);
  if (name.length > PROJECT_NAME_MAX) throw new ProjectError('INVALID', 'project name is too long');
  const description = (options.description ?? '').trim();
  if ([...description].length > DESCRIPTION_MAX) {
    throw new ProjectError('INVALID', `project description must be at most ${DESCRIPTION_MAX} characters`);
  }
  if (/[\r\n]/.test(description)) throw new ProjectError('INVALID', 'project description must be a single line');
  const registry = readRegistry(options.home);
  if (registry.projects.some((project) => project.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    throw new ProjectError('EXISTS', `project already exists: ${name}`);
  }
  const at = (options.now ?? new Date()).toISOString();
  const project: Project = { name, description, created_at: at, updated_at: at };
  writeRegistry(options.home, { schema: 1, projects: [...registry.projects, project] });
  return project;
}

/** Create an empty registry during `mem init`; existing files are kept. */
export function ensureProjectsFile(home: string): boolean {
  const file = memoryPaths(home).projectsFile;
  if (existsSync(file)) return false;
  writeRegistry(home, { schema: 1, projects: [] });
  return true;
}

/**
 * Remove a project label. Memories keep their frontmatter untouched; callers
 * map an unknown project to the "未归类" bucket. If the name is later recreated,
 * those memories become visible under it again by design.
 */
export function deleteProject(home: string, name: string): boolean {
  const registry = readRegistry(home);
  const lower = name.toLocaleLowerCase();
  const kept = registry.projects.filter((project) => project.name.toLocaleLowerCase() !== lower);
  if (kept.length === registry.projects.length) return false;
  writeRegistry(home, { schema: 1, projects: kept });
  return true;
}
