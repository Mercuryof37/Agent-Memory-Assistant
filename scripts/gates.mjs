import { resolve } from 'node:path';
import {
  gateCoreNoDynamicRegex,
  gateCorePurity,
  gateDshLayer,
  gateDocsSchemaKeys,
  gateFollowupIdentity,
  gateNoPaidHooks,
} from './lib/gates.mjs';

/**
 * Repository gates. Run before commit; `npm run ci` runs gates + typecheck + tests.
 */

const root = resolve(import.meta.dirname, '..');

const results = [
  gateCorePurity(root),
  gateDshLayer(root),
  gateNoPaidHooks(root),
  gateCoreNoDynamicRegex(root),
  gateFollowupIdentity(root),
  await gateDocsSchemaKeys(root),
];

let failed = 0;
for (const result of results) {
  const label = `${result.name} `;
  const dots = '.'.repeat(Math.max(3, 30 - label.length));
  console.log(`gate ${label}${dots} ${result.ok ? 'ok' : 'FAIL'} (${result.checked})`);
  for (const problem of result.problems) console.log(`  - ${problem}`);
  if (!result.ok) failed += 1;
}

if (failed > 0) {
  console.error(`\n${failed} gate(s) failed`);
  process.exit(1);
}
console.log('\nall gates passed');
