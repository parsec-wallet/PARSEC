#!/usr/bin/env node
// Spawn the BANKON Names Registry (BNR) AO process.
//
// PREFERRED PATH: spawn from the wallet UI — open Parsec, unlock with the
// maintainer Arweave key, then Dashboard → BANKON Names → "Spawn registry".
// The in-wallet flow uses the same primitives, persists the resulting
// process id to localStorage, and never asks for filesystem access.
//
// This CLI is the maintainer fallback for headless/CI environments or for
// re-spawning with --force after a UI spawn timed out.
//
// Usage:
//   DEPLOY_KEY=$(base64 -w0 maintainer-jwk.json) \
//     TREASURY_ARWEAVE=<address> \
//     INITIAL_CONTROLLER=<address> \
//     npx tsx scripts/spawn-bnr.mjs
//
// What it does:
//   1. Reads the Lua source from bankon-names-process/ and concatenates it.
//   2. Builds + signs an AO Spawn DataItem (RSA-PSS via WebCrypto).
//   3. POSTs to the AO MU and polls the CU until the spawn confirms.
//   4. Prints the new process id and writes it to
//      src/lib/bankon-names/process-id.ts.
//
// Re-running with a populated process-id.ts errors loudly. Force-respawn
// by passing --force (e.g. after the UI flow timed out mid-spawn).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PROCESS_DIR = join(ROOT, 'bankon-names-process');
const PROCESS_ID_FILE = join(ROOT, 'src/lib/bankon-names/process-id.ts');

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
  const match = existing.match(/BNR_PROCESS_ID\s*=\s*'([^']+)'/);
  const idStr = match ? match[1] : null;
  if (idStr && idStr !== '<TO_BE_SET_AFTER_SPAWN>') {
    console.error(`Refusing to respawn: ${PROCESS_ID_FILE} already has BNR_PROCESS_ID = ${idStr}`);
    console.error('Pass --force to override (you almost never want this).');
    process.exit(1);
  }
}

// ── Lua source bundling ────────────────────────────────────────
// The concatenated handlers ship as the Spawn DataItem's `data` payload.
// The process spawns on a real AOS module (ao.AOS_MODULE — the Module tag
// MUST be a real uploaded module TxID), and the `On-Boot: Data` tag tells
// AOS to evaluate that bundled Lua on boot.

const concat = (files) => files.map(f => readFileSync(join(PROCESS_DIR, f), 'utf8')).join('\n\n-- ──\n\n');
const luaSource = concat([
  'state.lua',
  'handlers/admin.lua',
  'handlers/governance.lua',
  'handlers/cost.lua',
  'handlers/claim.lua',
  'handlers/transfer.lua',
  'handlers/records.lua',
  'handlers/lease.lua',
  'handlers/primary.lua',
  'main.lua',
]);

console.log(`Bundled Lua source: ${luaSource.length} bytes`);

// ── Sign the Spawn DataItem ────────────────────────────────────

const jwkB64 = process.env.DEPLOY_KEY;
const jwk = JSON.parse(Buffer.from(jwkB64, 'base64').toString('utf8'));

// Lazy-import the project's own ANS-104 + ao modules. They're TS, so we
// run this script via tsx / through Vite. For a portable, dep-free path
// we re-implement just the slice we need here — but reuse via dynamic
// import keeps a single source of truth.

const ans104 = await import('../src/lib/arweave/ans104.ts').catch(async () => {
  // Fallback: tsx not available. Tell the user.
  console.error('Install tsx (`npm i -D tsx`) and run via `npx tsx scripts/spawn-bnr.mjs`.');
  process.exit(1);
});
const ao = await import('../src/lib/arweave/ao.ts');

const treasuryAr = process.env.TREASURY_ARWEAVE || '';
const initialController = process.env.INITIAL_CONTROLLER || '';

const spawnInput = {
  target: DEFAULT_SCHEDULER,
  tags: [
    { name: 'Data-Protocol', value: 'ao' },
    { name: 'Variant', value: 'ao.TN.1' },
    { name: 'Type', value: 'Process' },
    { name: 'Module', value: ao.AOS_MODULE },
    { name: 'Scheduler', value: DEFAULT_SCHEDULER },
    { name: 'On-Boot', value: 'Data' },
    { name: 'Authority', value: AO_AUTHORITY },
    { name: 'Name', value: 'BANKON-Names' },
    { name: 'Initial-Controller', value: initialController },
    { name: 'Treasury-Arweave', value: treasuryAr },
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

// Poll for confirmation.
const deadline = Date.now() + 120_000;
let confirmed = false;
while (Date.now() < deadline) {
  try {
    await ao.aoResult({ message: signed.id, process: signed.id });
    confirmed = true;
    break;
  } catch {
    await new Promise(r => setTimeout(r, 3000));
  }
}
if (!confirmed) {
  console.error(`Spawn ${signed.id} not confirmed within 120s. Try again later.`);
  process.exit(2);
}

// ── Patch process-id.ts ────────────────────────────────────────
// Surgical edit: only replace the two build-time constants. The
// runtime override layer (localStorage / Vite env var) lives in the
// same file and must not be clobbered.

const ts = readFileSync(PROCESS_ID_FILE, 'utf8');
const patched = ts
  .replace(/export const BNR_PROCESS_ID = '[^']*';/, `export const BNR_PROCESS_ID = '${signed.id}';`)
  .replace(/export const BNR_SPAWN_TIMESTAMP = \d+;/, `export const BNR_SPAWN_TIMESTAMP = ${Date.now()};`);
if (!patched.includes(`'${signed.id}'`)) {
  console.error('Failed to patch BNR_PROCESS_ID — file structure unrecognized.');
  process.exit(3);
}
writeFileSync(PROCESS_ID_FILE, patched);

console.log('');
console.log(`✓ BANKON Names Registry spawned: ${signed.id}`);
console.log(`  Written to: ${PROCESS_ID_FILE}`);
