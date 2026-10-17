/**
 * `mem` - local commands for the Agent Memory store.
 *
 * The CLI is a parameter transcriber, not a rule engine: it parses argv, calls
 * core, and prints what core returns. Its one privileged action is
 * `policy seal --accept`, the human-only T2 channel (plan v1.3 §5.4).
 */

import { relative } from 'node:path';
import {
  initStore,
  memoryPaths,
  MemoryStore,
  MemoryStoreError,
  ProposalError,
  decideProposal,
  listProposals,
  resolveHome,
  sealPolicy,
  startup,
  StartupError,
  type EnvLike,
  type Kind,
  type Runtime,
} from '../../core/src/index.ts';

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
          [--error-signature <csv>] [--json]
  mem read <id> [--json]
  mem recall <query> [--limit <n>] [--as-of YYYY-MM-DD] [--kind <kind>] [--json]
  mem adopt <id> [--json]
  mem delete <id> --reason <text> [--json]
  mem proposals [--home <dir>] [--json]
  mem decide <id> accept|reject [--reason <text>] [--accept] [--json]
  mem rebuild [--json]
  mem policy seal [--home <dir>] --accept

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
  'as-of',
  'limit',
  'reason',
]);
const BOOLEAN_FLAGS = new Set(['accept', 'json', 'help', 'version']);
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
        return commandRecall(parsed, io);
      case 'adopt':
        return commandAdopt(parsed, io);
      case 'delete':
        return commandDelete(parsed, io);
      case 'rebuild':
        return commandRebuild(parsed, io);
      case 'proposals':
        return commandProposals(parsed, io);
      case 'decide':
        return commandDecide(parsed, io);
      case 'policy':
        if (subcommand !== 'seal') throw new UsageError('usage: mem policy seal [--home <dir>] --accept');
        return commandSeal(parsed, io);
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
    if (error instanceof MemoryStoreError || error instanceof ProposalError) {
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
  const result = store.add(
    {
      kind,
      abstract,
      body: stringFlag(parsed, 'body') ?? '',
      ...(stringFlag(parsed, 'valid-from') === undefined ? {} : { valid_from: stringFlag(parsed, 'valid-from') }),
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

function commandRecall(parsed: ParsedArgs, io: CliIo): number {
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
  const result = store.recall(query, {
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

function commandProposals(parsed: ParsedArgs, io: CliIo): number {
  const runtime = openRuntime(parsed, io);
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

function commandSeal(parsed: ParsedArgs, io: CliIo): number {
  const home = resolveHome({ home: stringFlag(parsed, 'home'), env: io.env, cwd: io.cwd });
  const seal = sealPolicy({ home, accept: parsed.flags.has('accept') });
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
    `  inject:   ${config.inject.total_max_chars} chars total (persona ${config.inject.persona_max_chars} / user ${config.inject.user_max_chars} / rules ${config.inject.rules_max_chars} / index ${config.inject.index_max_chars})`,
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
