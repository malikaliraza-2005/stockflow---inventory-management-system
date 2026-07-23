/**
 * Permission-matrix generator (FD-3 / AAD §5.1) — emits the frontend copy of
 * SRS §5.2 from the ONE canonical definition
 * (src/config/permissionMatrix.ts) so it is generated, never hand-written.
 *
 *   node scripts/generate-permissions.mjs          # write client file
 *   node scripts/generate-permissions.mjs --check  # exit 1 on drift (CI)
 *
 * The canonical literal sits between BEGIN/END markers and is JSON-compatible
 * by contract — extracted textually so no TypeScript build is needed here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(here, '../src/config/permissionMatrix.ts');
const TARGET = resolve(here, '../../client/src/lib/permissions.generated.ts');

const source = readFileSync(SOURCE, 'utf8');
const match = source.match(
  /BEGIN PERMISSION MATRIX[^\n]*\nexport const PERMISSION_MATRIX = (\{[\s\S]*?\}) as const;\n\/\/ END PERMISSION MATRIX/,
);
if (!match) {
  console.error('generate-permissions: BEGIN/END markers not found in permissionMatrix.ts');
  process.exit(1);
}

// The marker contract guarantees a plain object literal.
const matrix = new Function(`return (${match[1]});`)();

const rows = Object.entries(matrix)
  .map(([capability, roles]) => `  '${capability}': [${roles.map((r) => `'${r}'`).join(', ')}],`)
  .join('\n');

const output = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Frontend copy of the SRS §5.2 permission matrix (FD-3), generated from
 * server/src/config/permissionMatrix.ts by server/scripts/generate-permissions.mjs.
 * CI fails if this file drifts from the canonical definition. \`usePermission()\`
 * reads it; components ask capability questions, never compare roles inline.
 */
export type Role = 'ADMIN' | 'STAFF';

export const PERMISSION_MATRIX = {
${rows}
} as const;

export type Capability = keyof typeof PERMISSION_MATRIX;

export function roleCan(role: Role, capability: Capability): boolean {
  return (PERMISSION_MATRIX[capability] as readonly Role[]).includes(role);
}
`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(TARGET, 'utf8');
  } catch {
    // missing file = drift
  }
  if (current !== output) {
    console.error(
      'generate-permissions: client/src/lib/permissions.generated.ts drifted from the canonical matrix — run "node scripts/generate-permissions.mjs" in server/ and commit the result',
    );
    process.exit(1);
  }
  console.log('permission matrix: client copy matches the canonical definition');
} else {
  writeFileSync(TARGET, output);
  console.log(`permission matrix written → ${TARGET}`);
}
