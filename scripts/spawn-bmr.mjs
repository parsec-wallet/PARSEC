#!/usr/bin/env node
// Spawn the BANKON Marketspace Registry (BMR). Mirrors scripts/spawn-bnr.mjs.
//
// PREFERRED PATH: in-wallet admin → BANKON Names admin → "Spawn BMR" tab.
// CLI is the maintainer fallback for headless/CI use.
//
// Usage:
//   DEPLOY_KEY=$(base64 -w0 maintainer-jwk.json) \
//     INITIAL_CONTROLLER=<address> \
//     TREASURY=<address> \
//     BNR_PROCESS_ID=<bnr-id> \
//     npx tsx scripts/spawn-bmr.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PROCESS_DIR = join(ROOT, 'marketplace-process');
const PROCESS_ID_FILE = join(ROOT, 'src/lib/marketplace/process-id.ts');

const DEFAULT_SCHEDULER = '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA';
const AO_AUTHORITY = 'fcoN_xJeisVsPXA-trzVAuIiqO3ydLQxM-L4XbrQKzY';
const AO_MU = 'https://mu.ao-testnet.xyz';
const AR_IO_CU = 'https://cu.ardrive.io';

const args = new Set(process.argv.slice(2));
const FORCE = args.has('--force');

if (!process.env.DEPLOY_KEY) {
  console.error('DEPLOY_KEY env var required (base64-encoded Arweave JWK).');
  process.exit(1);
}

if (existsSync(PROCESS_ID_FILE) && !FORCE) {
  const existing = readFileSync(PROCESS_ID_FILE, 'utf8');
  const match = existing.match(/BMR_PROCESS_ID\s*=\s*'([^']+)'/);
  const idStr = match ? match[1] : null;
  if (idStr && idStr !== '<TO_BE_SET_AFTER_SPAWN>') {
    console.error(`Refusing to respawn: ${PROCESS_ID_FILE} already has BMR_PROCESS_ID = ${idStr}`);
    console.error('Pass --force to override.');
    process.exit(1);
  }
}

const concat = (files) => files.map((f) => readFileSync(join(PROCESS_DIR, f), 'utf8')).join('\n\n-- ──\n\n');
const luaSource = concat([
  'state.lua',
  'handlers/governance.lua',
  'handlers/list.lua',
  'handlers/cancel.lua',
  'handlers/offer.lua',
  'handlers/auction.lua',
  'handlers/escrow.lua',
  'handlers/fees.lua',
  'handlers/settle.lua',
  'main.lua',
]);

console.log(`Bundled BMR Lua source: ${luaSource.length} bytes`);

const jwk = JSON.parse(Buffer.from(process.env.DEPLOY_KEY, 'base64').toString('utf8'));

const ans104 = await import('../src/lib/arweave/ans104.ts').catch(() => {
  console.error('Install tsx (`npm i -D tsx`) and run via `npx tsx scripts/spawn-bmr.mjs`.');
  process.exit(1);
});
const ao = await import('../src/lib/arweave/ao.ts');

const treasury = process.env.TREASURY || '';
const initialController = process.env.INITIAL_CONTROLLER || '';
const bnrProcessId = process.env.BNR_PROCESS_ID || '';

const spawnInput = {
  target: DEFAULT_SCHEDULER,
  tags: [
    { name: 'Data-Protocol', value: 'ao' },
    { name: 'Variant', value: 'ao.TN.1' },
    { name: 'Type', value: 'Process' },
    { name: 'Module', value: 'self-bundled' },
    { name: 'Scheduler', value: DEFAULT_SCHEDULER },
    { name: 'Authority', value: AO_AUTHORITY },
    { name: 'Name', value: 'BANKON-Marketspace' },
    { name: 'Initial-Controller', value: initialController },
    { name: 'Treasury', value: treasury },
    { name: 'Bnr-Process-Id', value: bnrProcessId },
    { name: 'SDK', value: 'parsec-wallet' },
  ],
  data: luaSource,
  owner: jwk.n,
};

const signed = await ans104.signDataItem(spawnInput, jwk);
console.log(`Signed Spawn DataItem id: ${signed.id}`);

ao.setAoEndpoints({ mu: AO_MU, cu: AR_IO_CU });
await ao.aoSpawn(signed);
console.log('Posted to AO MU.');

const deadline = Date.now() + 120_000;
let confirmed = false;
while (Date.now() < deadline) {
  try {
    await ao.aoResult({ message: signed.id, process: signed.id });
    confirmed = true;
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 3000));
  }
}
if (!confirmed) {
  console.error(`Spawn ${signed.id} not confirmed within 120s.`);
  process.exit(2);
}

// Surgical edit: only replace the build-time constant. The runtime
// override layer lives in the same file and must not be clobbered.

const ts = readFileSync(PROCESS_ID_FILE, 'utf8');
const patched = ts.replace(
  /export const BMR_PROCESS_ID = '[^']*';/,
  `export const BMR_PROCESS_ID = '${signed.id}';`,
);
if (!patched.includes(`'${signed.id}'`)) {
  console.error('Failed to patch BMR_PROCESS_ID — file structure unrecognized.');
  process.exit(3);
}
writeFileSync(PROCESS_ID_FILE, patched);

console.log('');
console.log(`✓ BANKON Marketspace Registry spawned: ${signed.id}`);
console.log(`  Written to: ${PROCESS_ID_FILE}`);
