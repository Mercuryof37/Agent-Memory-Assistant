import { existsSync, openSync, readFileSync, readSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * `npm run compat` — checks the *installed* DeepSeek Harness against the
 * versions and packages ADR-0003 pinned. It reads files only (no spawning):
 * sandboxed sessions cannot capture piped child output, and this check must
 * also work inside the agent sandbox.
 *
 * Live behaviour (plugin load, compaction, token pricing) stays manual —
 * ADR-0003 §5 lists M1–M4.
 */

const installRoot = process.env.DSH_INSTALL ?? 'D:\\DeepSeekHarness';
const runtimeJson = join(installRoot, 'resources', 'runtime', 'primary-runtime', 'runtime.json');
const versionsJson = join(installRoot, 'resources', 'runtime', 'versions.json');
const asarPath = join(installRoot, 'resources', 'app.asar');
const repoRoot = join(import.meta.dirname, '..');
const nodeVersionFile = join(repoRoot, '.node-version');

const errors = [];
const warnings = [];
const notes = [];

function fail(message) {
  errors.push(message);
}
function warn(message) {
  warnings.push(message);
}

if (!existsSync(runtimeJson)) {
  fail(`DSH runtime not found at ${runtimeJson} (set DSH_INSTALL to the install root)`);
} else {
  const runtime = JSON.parse(readFileSync(runtimeJson, 'utf8'));
  const versions = existsSync(versionsJson) ? JSON.parse(readFileSync(versionsJson, 'utf8')) : {};
  const pinnedNode = existsSync(nodeVersionFile) ? readFileSync(nodeVersionFile, 'utf8').trim() : '';

  notes.push(`desktop      ${runtime.desktopVersion}`);
  notes.push(`runtime node ${runtime.node}`);
  notes.push(`path node    ${process.versions.node}`);
  notes.push(`pinned node  ${pinnedNode || '(missing .node-version)'}`);

  if (pinnedNode !== runtime.node) {
    fail(`.node-version is ${pinnedNode || '(missing)'} but the DSH runtime ships node ${runtime.node}`);
  }
  if (versions.node && versions.node !== runtime.node) {
    warn(`versions.json says node ${versions.node}, runtime.json says ${runtime.node}`);
  }
  if (process.versions.node !== runtime.node) {
    warn(`this process runs node ${process.versions.node}; the plugin will run on ${runtime.node}`);
  }

  // Read the ASAR index to check the bundled packages without extracting them.
  if (!existsSync(asarPath)) {
    fail(`app.asar not found at ${asarPath}`);
  } else {
    const fd = openSync(asarPath, 'r');
    try {
      const head = Buffer.alloc(16);
      readSync(fd, head, 0, 16, 0);
      const jsonLen = head.readUInt32LE(12);
      const jsonBuf = Buffer.alloc(jsonLen);
      readSync(fd, jsonBuf, 0, jsonLen, 16);
      const header = JSON.parse(jsonBuf.toString('utf8'));

      const packages = new Map();
      const walk = (node, prefix) => {
        for (const [name, entry] of Object.entries(node.files ?? {})) {
          const full = prefix ? `${prefix}/${name}` : name;
          if (entry.files) walk(entry, full);
          else if (/^dsh\/node_modules\/@deepseek-ai\/[^/]+\/package\.json$/.test(full)) {
            packages.set(full.split('/')[3], entry);
          }
        }
      };
      walk(header, '');

      const required = [
        'dsh-tools',
        'dsh-system-prompt',
        'dsh-session',
        'dsh-session-persistence',
        'dsh-agent',
        'dsh-subagent',
        'dsh-commands',
        'dsh-token-meter',
        'dsh-sandbox-policy',
        'dsh-compaction-basic',
      ];
      for (const name of required) {
        if (!packages.has(name)) fail(`bundled package @deepseek-ai/${name} is missing`);
      }

      // Verify the package versions match the desktop runtime.
      const prefix = 'dsh/node_modules/@deepseek-ai/';
      for (const [name, entry] of packages) {
        if (!required.includes(name)) continue;
        const buf = Buffer.alloc(entry.size);
        const dataStart = Math.ceil((16 + jsonLen) / 4) * 4;
        readSync(fd, buf, 0, entry.size, dataStart + Number(entry.offset));
        const pkg = JSON.parse(buf.toString('utf8'));
        if (pkg.version !== runtime.desktopVersion) {
          fail(`${name}@${pkg.version} does not match desktop ${runtime.desktopVersion}`);
        }
      }
      notes.push(`packages     ${packages.size} bundled, ${required.length} required`);
    } finally {
      closeSync(fd);
    }
  }

  const profile = join(homedir(), '.dsh', 'profiles', 'desktop');
  if (!existsSync(profile)) warn(`desktop profile not found at ${profile}`);
  else notes.push(`profile      ${profile} (managed by the Electron app)`);

  const cliManifest = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
  if (existsSync(cliManifest)) {
    const cli = JSON.parse(readFileSync(cliManifest, 'utf8'));
    notes.push(`global cli   ${cli.version} (separate from the desktop runtime)`);
    if (cli.version !== runtime.desktopVersion) {
      warn(`global CLI ${cli.version} differs from desktop ${runtime.desktopVersion}; target the desktop version`);
    }
  }
}

for (const line of notes) console.log(`  ${line}`);
if (warnings.length > 0) {
  console.log('\nwarnings:');
  for (const line of warnings) console.log(`  - ${line}`);
}
if (errors.length > 0) {
  console.error('\ncompat failed:');
  for (const line of errors) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('\ncompat ok');
console.log('manual, needs a real session + app restart (ADR-0003 §5):');
for (const item of [
  'M1 minimal plugin (echo tool + one section) loads in the desktop app',
  'M2 section bytes stay stable across compaction in one session',
  'M3 ctx.tokenMeter prices the four injection sections',
  'M4 /closeout command starts a turn via agent.followup',
]) {
  console.log(`  - ${item}`);
}
