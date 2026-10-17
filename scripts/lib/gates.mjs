/**
 * CI gates as pure functions so they can be tested with fixture trees.
 *
 * A gate is only worth having if it fails on a planted violation; see
 * packages/core/test/gates.test.ts, which builds exactly that.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const CODE_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json']);

export function listFiles(dir, extensions = CODE_EXTENSIONS) {
  const files = [];
  if (!existsSync(dir)) return files;
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && extensions.has(full.slice(full.lastIndexOf('.')))) files.push(full);
    }
  };
  walk(dir);
  return files.sort();
}

function scan(files, root, predicate) {
  const hits = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((text, index) => {
      const message = predicate(text);
      if (message !== null) hits.push(`${relative(root, file)}:${index + 1} ${message}: ${text.trim()}`);
    });
  }
  return hits;
}

/**
 * Discipline 1: core is pure. Any mention of a host-scoped package is a
 * failure, not just an import, so a commented-out import cannot smuggle the
 * dependency back in.
 */
export function gateCorePurity(root) {
  const files = listFiles(join(root, 'packages', 'core'));
  const problems = scan(files, root, (text) =>
    text.includes('@deepseek-ai/') ? 'references a host package' : null,
  );
  return { name: 'core-purity', ok: problems.length === 0, checked: files.length, problems };
}

/**
 * Discipline 3: dynamic regex construction only in the scanner (`scan/`), so a
 * pattern cannot be assembled from model input elsewhere (plan v1.3 §9.2).
 */
export function gateCoreNoDynamicRegex(root) {
  const src = join(root, 'packages', 'core', 'src');
  const files = listFiles(src).filter((file) => !relative(src, file).replaceAll('\\', '/').startsWith('scan/'));
  const problems = scan(files, root, (text) =>
    /new\s+RegExp\s*\(/.test(text) || /(^|[^.\w])RegExp\s*\(/.test(text)
      ? 'dynamic RegExp is only allowed under packages/core/src/scan/'
      : null,
  );
  return { name: 'core-dynamic-regexp', ok: problems.length === 0, checked: files.length, problems };
}

/**
 * Discipline 2: the DSH adapter never touches files. It may only call core.
 */
const FILE_IO_PATTERNS = [
  /from\s+['"]node:fs(\/promises)?['"]/,
  /from\s+['"]fs(\/promises)?['"]/,
  /import\s*\(\s*['"]node:fs/,
  /require\s*\(\s*['"]node:fs/,
];

/**
 * Discipline 3: no paid-feature branches in core. V1 ships no entitlement
 * logic at all; a hook that is never injected is cheaper than one we must keep
 * correct. Scanned repo-wide for core only, with word boundaries so that
 * unrelated identifiers cannot trip it.
 */
const PAID_PATTERN = /\b(?:entitled|paid|tier|tiers|tiered)\b/i;

export function gateNoPaidHooks(root) {
  const files = listFiles(join(root, 'packages', 'core'));
  const problems = scan(files, root, (text) =>
    PAID_PATTERN.test(text) ? 'mentions a paid-feature concept (V1 has none)' : null,
  );
  return { name: 'core-no-paid-hooks', ok: problems.length === 0, checked: files.length, problems };
}

export function gateDshLayer(root) {
  const dir = join(root, 'packages', 'dsh', 'src');
  const files = listFiles(dir, new Set(['.ts', '.mts', '.js', '.mjs']));
  const problems = scan(files, root, (text) =>
    FILE_IO_PATTERNS.some((pattern) => pattern.test(text)) ? 'performs file I/O (call core instead)' : null,
  );
  return { name: 'dsh-no-file-io', ok: problems.length === 0, checked: files.length, problems };
}

const DOC_KEY = /^\|\s*`([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)`\s*\|/i;

export function documentedKeys(markdown) {
  const keys = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const match = DOC_KEY.exec(line.trim());
    if (match?.[1] !== undefined) keys.add(match[1]);
  }
  return keys;
}

function compareDoc(root, docPath, schemaKeys, label) {
  const full = join(root, docPath);
  if (!existsSync(full)) return [`${docPath} is missing; every ${label} key must be documented`];
  const documented = documentedKeys(readFileSync(full, 'utf8'));
  const problems = [];
  for (const key of schemaKeys) {
    if (!documented.has(key)) problems.push(`${docPath} does not document ${label} key "${key}"`);
  }
  for (const key of documented) {
    if (!schemaKeys.includes(key)) problems.push(`${docPath} documents "${key}", which is not in the ${label} schema`);
  }
  return problems;
}

/**
 * Discipline 3 (CI gate 6): the docs and the schema cannot drift apart. The
 * schema is the source of truth; the docs table is checked by key name.
 */
export async function gateDocsSchemaKeys(root) {
  const core = await import(pathToFileURL(join(root, 'packages', 'core', 'src', 'index.ts')).href);
  const problems = [
    ...compareDoc(root, 'docs/config.md', core.configKeys(), 'config'),
    ...compareDoc(root, 'docs/policy.md', core.policyKeys(), 'policy'),
  ];
  return { name: 'docs-schema-keys', ok: problems.length === 0, checked: 2, problems };
}
