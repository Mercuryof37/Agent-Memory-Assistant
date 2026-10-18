/**
 * `mem` - local commands for the Agent Memory store.
 *
 * The CLI is a parameter transcriber, not a rule engine: it parses argv, calls
 * core, and prints what core returns. Its one privileged action is
 * `policy seal --accept`, the human-only T2 channel (plan v1.3 §5.4).
 */

import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  initStore,
  loadProfile,
  memoryPaths,
  MemoryStore,
  MemoryStoreError,
  ProjectError,
  createProject,
  embedTexts,
  importMem0,
  listProjects,
  previewMem0,
  vectorizerCommand,
  writeEmbeddingCache,
  ProposalError,
  queryProfile,
  decideProposal,
  exportStore,
  inspectStore,
  listProposals,
  resolveHome,
  scaffoldPersonalization,
  sealPolicy,
  startup,
  StartupError,
  type EnvLike,
  type Kind,
  type Runtime,
} from '../../core/src/index.ts';
import { commandMcp } from './mcp.ts';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_REFUSED = 2;
export const EXIT_CONFIRMATION_MISSING = 3;
export const EXIT_DEGRADED = 4;

export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly env: EnvLike;
  readonly cwd: string;
}

export interface CliOptions {
  readonly out?: (text: string) => void;
  readonly err?: (text: string) => void;
  readonly env?: EnvLike;
  readonly cwd?: string;
}

const USAGE = `mem - Agent Memory V1.0 (S2b)

Usage:
  mem init [--home <dir>]
  mem doctor [--home <dir>] [--config <file>] [--json]
  mem add --abstract <text> [--kind fact|pitfall|exp] [--body <text>]
          [--valid-from YYYY-MM-DD] [--evidence-level <level>]
          [--error-signature <csv>] [--project <name>] [--tag <csv>] [--json]
  mem read <id> [--json]
  mem recall <query> [--limit <n>] [--as-of YYYY-MM-DD] [--kind <kind>] [--json]
  mem adopt <id> [--json]
  mem delete <id> --reason <text> [--json]
  mem profile [query] [--json]
  mem scaffold [--home <dir>]
  mem proposals [--home <dir>] [--json]
  mem project list [--home <dir>] [--json]
  mem project add <name> [--description <text>] [--home <dir>] [--json]
  mem embed [--apply] [--home <dir>] [--json]   (sidecar vector cache)
  mem import-mem0 <file> [--apply] [--home <dir>] [--json]
  mem decide <id> accept|reject [--reason <text>] [--accept] [--json]
  mem decide --batch accept|reject [--reason <text>] [--accept]
  mem rebuild [--json]
  mem inspect [--limit <n>] [--json]
  mem export <dir>
  mem pack <dir>
  mem purge <id> --accept [--reason <text>]
  mem mcp [--home <dir>]                 (stdio MCP server for Codex/other agents)
  mem policy seal [--home <dir>] --accept [--seal-user]

Options:
  --home <dir>     store directory (default: $AGENT_MEMORY_HOME, else $DSH_HOME/memory)
  --config <file>  config.toml to load (default: <home>/config.toml)
  --reason <text>  why a memory is being deleted (required)
  --json           machine-readable output
  --accept         required to re-seal policy.json after a human edit

Exit codes:
  0 ok | 1 usage | 2 refused (config/policy/validation) | 3 confirmation missing | 4 degraded (quarantined items)
`;

const VALUE_FLAGS = new Set([
  'home',
  'config',
  'kind',
  'abstract',
  'body',
  'valid-from',
  'evidence-level',
  'error-signature',
  'project',
  'tag',
  'description',
  'as-of',
  'limit',
  'reason',
]);
const BOOLEAN_FLAGS = new Set(['accept', 'batch', 'json', 'help', 'version', 'seal-user', 'apply']);
const KINDS: readonly Kind[] = ['fact', 'pitfall', 'exp'];

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string | true>;
}

export async function run(argv: readonly string[], options: CliOptions = {}): Promise<number> {
  const io: CliIo = {
    out: options.out ?? ((text) => process.stdout.write(`${text}\n`)),
    err: options.err ?? ((text) => process.stderr.write(`${text}\n`)),
    env: options.env ?? process.env,
    cwd: options.cwd ?? process.cwd(),
  };

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`mem: ${error.message}`);
      io.err(USAGE);
      return EXIT_USAGE;
    }
    throw error;
  }

  const [command, subcommand] = parsed.positionals;
  try {
    if (parsed.flags.has('help') || command === undefined || command === 'help') {
      io.out(USAGE);
      return EXIT_OK;
    }
    if (parsed.flags.has('version') || command === 'version') {
      io.out('agent-memory 0.1.0 (V1.0 S2b)');
      return EXIT_OK;
    }
    switch (command) {
      case 'init':
        return commandInit(parsed, io);
      case 'doctor':
        return commandDoctor(parsed, io);
      case 'add':
        return commandAdd(parsed, io);
      case 'read':
        return commandRead(parsed, io);
      case 'recall':
        return await commandRecall(parsed, io);
      case 'adopt':
        return commandAdopt(parsed, io);
      case 'profile':
        return commandProfile(parsed, io);
      case 'scaffold':
        return commandScaffold(parsed, io);
      case 'delete':
        return commandDelete(parsed, io);
      case 'rebuild':
        return commandRebuild(parsed, io);
      case 'proposals':
        return commandProposals(parsed, io);
      case 'project':
        return commandProject(parsed, io);
      case 'embed':
        return await commandEmbed(parsed, io);
      case 'import-mem0':
        return await commandImportMem0(parsed, io);
      case 'decide':
        return commandDecide(parsed, io);
      case 'inspect':
        return commandInspect(parsed, io);
      case 'export':
        return commandExport(parsed, io);
      case 'pack':
        return commandExport(parsed, io);
      case 'purge':
        return commandPurge(parsed, io);
      case 'policy':
        if (subcommand !== 'seal') throw new UsageError('usage: mem policy seal [--home <dir>] --accept');
        return commandSeal(parsed, io);
      case 'mcp':
        return commandMcp({ ...(stringFlag(parsed, 'home') === undefined ? {} : { home: stringFlag(parsed, 'home') }) });
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`mem: ${error.message}`);
      io.err(USAGE);
      return EXIT_USAGE;
    }
    if (error instanceof StartupError) {
      io.err(error.format());
      return error.code === 'SEAL_REFUSED' ? EXIT_CONFIRMATION_MISSING : EXIT_REFUSED;
    }
    if (error instanceof MemoryStoreError || error instanceof ProposalError || error instanceof ProjectError) {
      io.err(`mem: ${error.message}`);
      return EXIT_REFUSED;
    }
    io.err(`mem: unexpected failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    return EXIT_USAGE;
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  return run(argv);
}

function openRuntime(parsed: ParsedArgs, io: CliIo): Runtime {
  return startup({
    home: stringFlag(parsed, 'home'),
    configPath: stringFlag(parsed, 'config'),
    env: io.env,
    cwd: io.cwd,
  });
}

function openStore(runtime: Runtime): MemoryStore {
  return new MemoryStore({ home: runtime.home, config: runtime.config });
}

function commandInit(parsed: ParsedArgs, io: CliIo): number {
  const home = resolveHome({ home: stringFlag(parsed, 'home'), env: io.env, cwd: io.cwd });
  const result = initStore({ home });
  io.out(`store: ${result.home}`);
  io.out(`  created directories: ${result.createdDirs.length}`);
  io.out(`  created files: ${formatList(result.createdFiles, result.home)}`);
  io.out(`  kept as-is: ${formatList(result.keptFiles, result.home)}`);
  io.out(`  policy sha256: ${result.sealSha256}`);
  io.out('run `mem doctor` to verify the store');
  return EXIT_OK;
}

function commandDoctor(parsed: ParsedArgs, io: CliIo): number {
  const runtime = openRuntime(parsed, io);
  const store = openStore(runtime);
  const stats = store.stats();
  const diagnostics = store.diagnostics();
  const quarantined = [...diagnostics.quarantined.entries()].map(([id, reason]) => ({ id, reason }));
  if (parsed.flags.has('json')) {
    io.out(JSON.stringify({ ...doctorSummary(runtime), stats, quarantine: quarantined, issues: diagnostics.issues }, null, 2));
  } else {
    io.out(formatDoctor(runtime, stats, diagnostics.issues, quarantined));
    const paths = memoryPaths(runtime.home);
    const present = [paths.soulFile, paths.userFile, paths.rulesFile].filter((file) => existsSync(file)).length;
    if (present < 3) {
      io.err('hint: run `mem scaffold` to create SOUL.md / USER.md / RULES.md (persona, preferences, rules)');
    }
    const profile = loadProfile(runtime.home);
    if (profile.chars > runtime.config.inject.user_max_chars) {
      io.err(
        `warning: USER.md is ${profile.chars} chars, over the ${runtime.config.inject.user_max_chars}-char injection budget (the injected copy is truncated)`,
      );
    }
  }
  if (diagnostics.issues.length > 0) {
    io.err('journal is inconsistent; writes are blocked until it is repaired');
    return EXIT_REFUSED;
  }
  if (stats.quarantined > 0) {
    io.err('some memories are quarantined; run `mem adopt <id>` after reviewing a file');
    return EXIT_DEGRADED;
  }
  return EXIT_OK;
}

function commandAdd(parsed: ParsedArgs, io: CliIo): number {
  const runtime = openRuntime(parsed, io);
  const abstract = stringFlag(parsed, 'abstract');
  if (abstract === undefined) throw new UsageError('mem add needs --abstract <text>');
  const kind = (stringFlag(parsed, 'kind') ?? 'fact') as Kind;
  if (!KINDS.includes(kind)) throw new UsageError(`--kind must be one of ${KINDS.join(', ')}`);
  const evidence = stringFlag(parsed, 'evidence-level') ?? 'user_explicit';
  const signaturesRaw = stringFlag(parsed, 'error-signature');
  const errorSignatures =
    signaturesRaw === undefined
      ? []
      : signaturesRaw.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
  const store = openStore(runtime);
  const project = stringFlag(parsed, 'project');
  const tagsRaw = stringFlag(parsed, 'tag');
  const tags = tagsRaw === undefined ? undefined : tagsRaw.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '');
  const result = store.add(
    {
      kind,
      abstract,
      body: stringFlag(parsed, 'body') ?? '',
      ...(stringFlag(parsed, 'valid-from') === undefined ? {} : { valid_from: stringFlag(parsed, 'valid-from') }),
      ...(project === undefined ? {} : { project }),
      ...(tags === undefined ? {} : { tags }),
      evidence_level: evidence as 'user_explicit' | 'user_confirmed' | 'observed',
      error_signatures: errorSignatures,
    },
    { author: 'human' },
  );
  if (parsed.flags.has('json')) io.out(JSON.stringify(result, null, 2));
  else io.out(`${result.deduplicated ? 'existing' : 'added'} ${result.id}`);
  return EXIT_OK;
}

function commandRead(parsed: ParsedArgs, io: CliIo): number {
  const id = parsed.positionals[1];
  if (id === undefined) throw new UsageError('mem read <id>');
  const runtime = openRuntime(parsed, io);
  const store = openStore(runtime);
  const doc = store.read(id);
  if (parsed.flags.has('json')) {
    io.out(JSON.stringify(doc, null, 2));
    return EXIT_OK;
  }
  io.out(`${doc.kind} ${doc.id} [${doc.valid_from} .. ${doc.valid_until ?? 'open'}]`);
  io.out(`abstract: ${doc.abstract}`);
  if (doc.error_signatures.length > 0) io.out(`signatures: ${doc.error_signatures.join(' | ')}`);
  io.out('');
  io.out(doc.body.trimEnd());
  return EXIT_OK;
}

async function commandRecall(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const query = parsed.positionals.slice(1).join(' ');
  if (query === '') throw new UsageError('mem recall <query>');
  const runtime = openRuntime(parsed, io);
  const store = openStore(runtime);
  const kindsFlag = stringFlag(parsed, 'kind');
  if (kindsFlag !== undefined && !KINDS.includes(kindsFlag as Kind)) {
    throw new UsageError(`--kind must be one of ${KINDS.join(', ')}`);
  }
  const limitText = stringFlag(parsed, 'limit');
  const limit = limitText === undefined ? undefined : Number(limitText);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new UsageError('--limit must be a positive integer');
  }
  const result = await store.recallAsync(query, {
    ...(limit === undefined ? {} : { limit }),
    ...(stringFlag(parsed, 'as-of') === undefined ? {} : { asOf: stringFlag(parsed, 'as-of') }),
    ...(kindsFlag === undefined ? {} : { kinds: [kindsFlag as Kind] }),
  });
  if (parsed.flags.has('json')) {
    io.out(JSON.stringify(result, null, 2));
    return EXIT_OK;
  }
  if (result.hits.length === 0) io.out('no matches');
  for (const hit of result.hits) io.out(`- [${hit.kind}] ${hit.abstract} — ${hit.id}`);
  for (const warning of result.warnings) io.err(`warning: ${warning}`);
  return EXIT_OK;
}

function commandAdopt(parsed: ParsedArgs, io: CliIo): number {
  const id = parsed.positionals[1];
  if (id === undefined) throw new UsageError('mem adopt <id>');
  const runtime = openRuntime(parsed, io);
  const result = openStore(runtime).adopt(id);
  if (parsed.flags.has('json')) io.out(JSON.stringify(result, null, 2));
  else io.out(`adopted ${result.id}`);
  return EXIT_OK;
}

function commandDelete(parsed: ParsedArgs, io: CliIo): number {
  const id = parsed.positionals[1];
  if (id === undefined) throw new UsageError('mem delete <id> --reason <text>');
  const reason = stringFlag(parsed, 'reason');
  if (reason === undefined || reason.trim() === '') throw new UsageError('mem delete needs --reason <text>');
  const runtime = openRuntime(parsed, io);
  const result = openStore(runtime).remove(id, { reason });
  if (parsed.flags.has('json')) io.out(JSON.stringify(result, null, 2));
  else io.out(`deleted ${result.id}`);
  return EXIT_OK;
}

function commandRebuild(parsed: ParsedArgs, io: CliIo): number {
  const runtime = openRuntime(parsed, io);
  const report = openStore(runtime).rebuild();
  if (parsed.flags.has('json')) {
    io.out(JSON.stringify(report, null, 2));
    return EXIT_OK;
  }
  io.out(`records: ${report.records} (files ${report.files})`);
  io.out(`journal: ${report.journal_head === null ? 'empty' : `#${report.journal_head.seq} ${report.journal_head.hash.slice(0, 12)}`}`);
  io.out(`quarantined: ${report.quarantined.length}`);
  return report.quarantined.length > 0 ? EXIT_DEGRADED : EXIT_OK;
}

async function commandEmbed(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const runtime = openRuntime(parsed, io);
  const store = openStore(runtime);
  const command = vectorizerCommand();
  if (command === undefined) {
    throw new UsageError('set AGENT_MEMORY_VECTORIZER to a command: <cmd> <input.json> <output.json>');
  }
  if (!parsed.flags.has('apply')) {
    io.out(`embed: would vectorize ${store.active().length} active memories with ${command}`);
    io.out('embed: dry run; re-run with --apply to write .index/embeddings.json');
    return EXIT_OK;
  }
  const docs = store.active().map((doc) => ({ id: doc.id, text: `${doc.abstract}\n${doc.body}` }));
  const result = await embedTexts(command, docs.map((doc) => doc.text));
  const vectors: Record<string, number[]> = {};
  for (let index = 0; index < docs.length; index += 1) {
    vectors[docs[index]?.id as string] = [...(result.vectors[index] ?? [])];
  }
  writeEmbeddingCache(runtime.home, {
    schema: 1,
    provider: command,
    dimensions: result.dimensions,
    generated_at: new Date().toISOString(),
    docs: vectors,
  });
  if (parsed.flags.has('json')) {
    io.out(JSON.stringify({ embedded: docs.length, dimensions: result.dimensions }, null, 2));
  } else {
    io.out(`embedded ${docs.length} memories (${result.dimensions} dimensions)`);
  }
  return EXIT_OK;
}

async function commandImportMem0(parsed: ParsedArgs, io: CliIo): Promise<number> {
  const file = parsed.positionals[1];
  if (file === undefined) throw new UsageError('usage: mem import-mem0 <file> [--apply]');
  if (!existsSync(file)) throw new UsageError(`file not found: ${file}`);
  let bundle: unknown;
  try {
    bundle = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new UsageError(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const preview = previewMem0(bundle);
  if (!parsed.flags.has('apply')) {
    if (parsed.flags.has('json')) io.out(JSON.stringify({ preview, applied: false }, null, 2));
    else {
      io.out(`mem0: ${preview.valid}/${preview.total} valid (${preview.invalid} invalid)`);
      io.out(`  kinds: ${JSON.stringify(preview.byKind)}  projects: ${JSON.stringify(preview.byProject)}`);
      for (const sample of preview.samples) io.out(`  sample: [${sample.kind}] ${sample.abstract}`);
      for (const error of preview.errors) io.out(`  invalid row ${error.index + 1}: ${error.reason}`);
      io.out('dry run; re-run with --apply to import');
    }
    return EXIT_OK;
  }
  const runtime = openRuntime(parsed, io);
  const report = importMem0(openStore(runtime), bundle);
  if (parsed.flags.has('json')) io.out(JSON.stringify({ report, applied: true }, null, 2));
  else {
    io.out(`mem0: imported ${report.imported}, skipped ${report.skipped}, failed ${report.failed.length}`);
    for (const failure of report.failed) io.out(`  failed ${failure.abstract}: ${failure.error}`);
  }
  return report.failed.length === 0 ? EXIT_OK : EXIT_DEGRADED;
}

function commandProject(parsed: ParsedArgs, io: CliIo): number {  const runtime = openRuntime(parsed, io);
  const subcommand = parsed.positionals[1];
  if (subcommand === 'list') {
    const projects = listProjects(runtime.home);
    if (parsed.flags.has('json')) {
      io.out(JSON.stringify({ projects }, null, 2));
      return EXIT_OK;
    }
    if (projects.length === 0) io.out('no projects yet; run `mem project add <name>`');
    for (const project of projects) {
      const description = project.description === '' ? '' : ` — ${project.description}`;
      io.out(`- ${project.name}${description}`);
    }
    return EXIT_OK;
  }
  if (subcommand === 'add') {
    const name = parsed.positionals[2];
    if (name === undefined) throw new UsageError('usage: mem project add <name> [--description <text>]');
    const project = createProject({
      home: runtime.home,
      name,
      ...(stringFlag(parsed, 'description') === undefined
        ? {}
        : { description: stringFlag(parsed, 'description') as string }),
    });
    if (parsed.flags.has('json')) io.out(JSON.stringify(project, null, 2));
    else io.out(`created project ${project.name}`);
    return EXIT_OK;
  }
  throw new UsageError('usage: mem project list | mem project add <name> [--description <text>]');
}

function commandProposals(parsed: ParsedArgs, io: CliIo): number {  const runtime = openRuntime(parsed, io);
  const proposals = listProposals(openStore(runtime));
  if (parsed.flags.has('json')) {
    io.out(JSON.stringify(proposals, null, 2));
    return EXIT_OK;
  }
  if (proposals.length === 0) {
    io.out('no pending proposals');
    return EXIT_OK;
  }
  for (const proposal of proposals) {
    io.out(`${proposal.id}  ${proposal.op}  ${proposal.targets.join(',')}  ${proposal.reason}`);
  }
  return EXIT_OK;
}

function commandDecide(parsed: ParsedArgs, io: CliIo): number {
  const batch = parsed.flags.has('batch');
  if (batch) {
    const decision = parsed.positionals[1];
    if (decision !== 'accept' && decision !== 'reject') {
      throw new UsageError('mem decide --batch accept|reject');
    }
    if (decision === 'accept' && !parsed.flags.has('accept')) {
      io.err('mem: accepting proposals needs --accept (human confirmation)');
      return EXIT_CONFIRMATION_MISSING;
    }
    const runtime = openRuntime(parsed, io);
    const store = openStore(runtime);
    const pending = listProposals(store);
    let failures = 0;
    for (const proposal of pending) {
      try {
        decideProposal(
          { store, config: runtime.config },
          {
            id: proposal.id,
            decision,
            ...(stringFlag(parsed, 'reason') === undefined ? {} : { reason: stringFlag(parsed, 'reason') }),
          },
        );
      } catch (error) {
        failures += 1;
        io.err(`mem: ${proposal.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    io.out(`${decision === 'accept' ? 'accepted' : 'rejected'} ${pending.length - failures}/${pending.length}`);
    return failures > 0 ? EXIT_REFUSED : EXIT_OK;
  }
  const id = parsed.positionals[1];
  const decision = parsed.positionals[2];
  if (id === undefined || (decision !== 'accept' && decision !== 'reject')) {
    throw new UsageError('mem decide <id> accept|reject [--accept]');
  }
  if (decision === 'accept' && !parsed.flags.has('accept')) {
    io.err('mem: accepting a proposal needs --accept (human confirmation)');
    return EXIT_CONFIRMATION_MISSING;
  }
  const runtime = openRuntime(parsed, io);
  decideProposal(
    { store: openStore(runtime), config: runtime.config },
    { id, decision, ...(stringFlag(parsed, 'reason') === undefined ? {} : { reason: stringFlag(parsed, 'reason') }) },
  );
  io.out(`${decision === 'accept' ? 'accepted' : 'rejected'} ${id}`);
  return EXIT_OK;
}

function commandInspect(parsed: ParsedArgs, io: CliIo): number {
  const runtime = openRuntime(parsed, io);
  const store = openStore(runtime);
  const limitText = stringFlag(parsed, 'limit');
  const limit = limitText === undefined ? 10 : Number(limitText);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new UsageError('--limit must be a positive integer');
  const report = inspectStore({ home: runtime.home, config: runtime.config, store, limit });
  if (parsed.flags.has('json')) {
    io.out(JSON.stringify(report, null, 2));
    return EXIT_OK;
  }
  io.out(`records: ${report.active} active (fact ${report.byKind.fact}, pitfall ${report.byKind.pitfall}, exp ${report.byKind.exp})`);
  io.out(`pending proposals: ${report.pendingProposals} · quarantined: ${report.quarantined.length}`);
  io.out(`journal head: ${report.journalHead === null ? 'empty' : `#${report.journalHead.seq} ${report.journalHead.hash.slice(0, 12)}`}`);
  io.out(`rules: ${report.rules.length === 0 ? '(none)' : ''}`);
  for (const rule of report.rules) io.out(`  ${rule.number}. [${rule.category}] ${rule.text}`);
  io.out('recent journal:');
  for (const entry of report.journal) io.out(`  #${entry.seq} ${entry.at} ${entry.op} ${entry.op_id}`);
  io.out(`budget: index ${report.budget.indexChars} chars · total ${report.budget.totalChars} chars`);
  io.out(
    `personalization: SOUL ${report.personalization.soul || 'missing'} · USER ${report.personalization.user || 'missing'} · RULES ${report.personalization.rules || 'missing'} chars`,
  );
  if (report.personalization.soul > report.inject.persona_max_chars) {
    io.err(`warning: SOUL.md ${report.personalization.soul} chars, over the ${report.inject.persona_max_chars}-char injection budget (truncated on inject)`);
  }
  if (report.personalization.user > report.inject.user_max_chars) {
    io.err(`warning: USER.md ${report.personalization.user} chars, over the ${report.inject.user_max_chars}-char injection budget (truncated on inject)`);
  }
  if (report.personalization.rules > report.inject.rules_max_chars) {
    io.err(`warning: RULES.md ${report.personalization.rules} chars, over the ${report.inject.rules_max_chars}-char injection budget (injection fails)`);
  }
  return EXIT_OK;
}

function commandExport(parsed: ParsedArgs, io: CliIo): number {
  const out = parsed.positionals[1];
  if (out === undefined) throw new UsageError('mem export <dir>');
  const runtime = openRuntime(parsed, io);
  const result = exportStore({ home: runtime.home, out });
  io.out(`exported ${result.files} files (${result.bytes} bytes) to ${result.out}`);
  io.out(`checksums: ${result.sums}`);
  return EXIT_OK;
}

function commandPurge(parsed: ParsedArgs, io: CliIo): number {
  const id = parsed.positionals[1];
  if (id === undefined) throw new UsageError('mem purge <id> --accept');
  if (!parsed.flags.has('accept')) {
    io.err('mem: purge needs --accept (human confirmation; this removes the file)');
    return EXIT_CONFIRMATION_MISSING;
  }
  const runtime = openRuntime(parsed, io);
  const result = openStore(runtime).purge(id, { reason: stringFlag(parsed, 'reason') ?? 'purge' });
  io.out(`purged ${id} · invalidated ${result.proposals} pending proposal(s)`);
  return EXIT_OK;
}

function commandProfile(parsed: ParsedArgs, io: CliIo): number {
  const runtime = openRuntime(parsed, io);
  const snapshot = loadProfile(runtime.home);
  const query = parsed.positionals.slice(1).join(' ');
  const entries = query.trim() === '' ? [...snapshot.entries] : queryProfile(snapshot.entries, query);
  if (parsed.flags.has('json')) {
    io.out(JSON.stringify({ entries, total: snapshot.entries.length, chars: snapshot.chars }, null, 2));
    return EXIT_OK;
  }
  if (entries.length === 0) io.out('USER.md has no matching entries');
  else {
    io.out(`USER.md: ${snapshot.entries.length} entries / ${snapshot.chars} chars`);
    entries.forEach((entry, index) => io.out(`${index + 1}. ${entry}`));
  }
  if (snapshot.chars > runtime.config.inject.user_max_chars) {
    io.err(`warning: USER.md is ${snapshot.chars} chars, over the ${runtime.config.inject.user_max_chars}-char injection budget (truncated on inject)`);
  }
  return EXIT_OK;
}

function commandScaffold(parsed: ParsedArgs, io: CliIo): number {
  const home = resolveHome({ home: stringFlag(parsed, 'home'), env: io.env, cwd: io.cwd });
  const result = scaffoldPersonalization({ home });
  if (result.created.length > 0) io.out(`created: ${result.created.join(', ')}`);
  if (result.kept.length > 0) io.out(`kept: ${result.kept.join(', ')}`);
  io.out(`policy sealed: ${result.sealSha256}`);
  io.out('edit SOUL.md / USER.md / RULES.md, then run `mem policy seal --accept` to apply');
  return EXIT_OK;
}

function commandSeal(parsed: ParsedArgs, io: CliIo): number {
  const home = resolveHome({ home: stringFlag(parsed, 'home'), env: io.env, cwd: io.cwd });
  const seal = sealPolicy({ home, accept: parsed.flags.has('accept'), sealUser: parsed.flags.has('seal-user') });
  io.out(`policy sealed: ${seal.sealPath}`);
  io.out(`  sha256: ${seal.sha256}`);
  const sealedCount = [seal.sealedFiles.soul, seal.sealedFiles.user, seal.sealedFiles.rules].filter(
    (value) => value !== '',
  ).length;
  io.out(`  sealed files: ${sealedCount} (SOUL/USER/RULES; empty hash = skipped)`);
  if (seal.previousSha256 !== null && seal.previousSha256 !== seal.sha256) {
    io.out(`  previous: ${seal.previousSha256}`);
  }
  return EXIT_OK;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const equals = body.indexOf('=');
      const name = equals >= 0 ? body.slice(0, equals) : body;
      const inline = equals >= 0 ? body.slice(equals + 1) : undefined;
      if (BOOLEAN_FLAGS.has(name)) {
        if (inline !== undefined) throw new UsageError(`--${name} does not take a value`);
        flags.set(name, true);
        continue;
      }
      if (VALUE_FLAGS.has(name)) {
        if (inline !== undefined) {
          flags.set(name, inline);
          continue;
        }
        const value = argv[index + 1];
        if (value === undefined) throw new UsageError(`--${name} needs a value`);
        flags.set(name, value);
        index += 1;
        continue;
      }
      throw new UsageError(`unknown flag --${name}`);
    }
    if (arg.startsWith('-') && arg !== '-') throw new UsageError(`unknown flag ${arg}`);
    positionals.push(arg);
  }
  return { positionals, flags };
}

function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

function formatList(files: readonly string[], home: string): string {
  if (files.length === 0) return '(nothing)';
  return files.map((file) => relative(home, file) || file).join(', ');
}

function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

function doctorSummary(runtime: Runtime) {
  const paths = memoryPaths(runtime.home);
  return {
    home: runtime.home,
    config: runtime.configPath,
    policy: {
      path: paths.policyFile,
      sha256: runtime.policySha256,
      sealed_at: runtime.sealedAt,
      capacity: runtime.policy.capacity,
      scan: runtime.policy.scan,
    },
    limits: runtime.config.storage,
    inject: runtime.config.inject,
    recall: runtime.config.recall,
    warnings: runtime.warnings,
  };
}

function formatDoctor(
  runtime: Runtime,
  stats: ReturnType<MemoryStore['stats']>,
  issues: readonly string[],
  quarantine: readonly { id: string; reason: string }[],
): string {
  const { config } = runtime;
  const lines = [
    'Agent Memory - store check',
    `  home:     ${runtime.home}`,
    `  config:   ${runtime.configPath ?? '(built-in defaults)'}`,
    `  policy:   sealed ${runtime.sealedAt || '(unknown)'} · sha256 ${shortHash(runtime.policySha256)}`,
    `  capacity: ${config.storage.max_records} records · ${config.storage.max_record_chars} chars/file`,
    `  inject:   ${config.inject.total_max_chars} chars total (persona ${config.inject.persona_max_chars} / guidance ${config.inject.guidance_max_chars} / user ${config.inject.user_max_chars} / rules ${config.inject.rules_max_chars} / index ${config.inject.index_max_chars})`,
    `  recall:   ${config.recall.limit} hits (max ${config.recall.max_limit})`,
    `  journal:  ${stats.journal_head === null ? 'empty' : `#${stats.journal_head.seq} ${shortHash(stats.journal_head.hash)}`} · ${stats.journal_consistent ? 'consistent' : 'INCONSISTENT'}`,
    `  records:  ${stats.active} active · ${stats.total_files} files · ${stats.deleted} deleted`,
    `  quarantined: ${stats.quarantined}`,
    `  warnings: ${runtime.warnings.length}`,
  ];
  for (const warning of runtime.warnings) lines.push(`    - ${warning}`);
  for (const entry of quarantine.slice(0, 5)) lines.push(`    x ${entry.id}: ${entry.reason}`);
  for (const issue of issues.slice(0, 5)) lines.push(`    ! ${issue}`);
  lines.push(issues.length === 0 && quarantine.length === 0 ? 'ok' : 'check failed');
  return lines.join('\n');
}
