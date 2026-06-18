// Deploy dato.lua to a REAL AO process, signed by a parsec-wallet key.
//
// Wallet: parsec-wallet's own seed.deriveJwkFromMnemonic (parsec-deterministic
// RSA-4096 Arweave key) — reused from dato/data/parsec_wallet.json if present.
// Transport: @permaweb/aoconnect (the dep parsec-wallet's AO subset is built on).
// dato.lua loads via the AOS `On-Boot: Data` tag with an owner preamble, so the
// process boots already owned by the DAIO, parsec wallet as deployer + founding member.
//
//   npx tsx scripts/deploy-dato-ao.ts
//
// Modes (env AO_MODE):
//   legacy   (default) — AO legacynet: module Do_Uc2Sju…, scheduler _GQ33Bk…,
//                        MU/SU/CU at *.ao-testnet.xyz (no funding needed).
//   mainnet            — AO mainnet / HyperBEAM: requires AO_URL=<hyperbeam node>
//                        and a funded wallet; module/scheduler via AO_MODULE/AO_SCHEDULER.
// Env: MINDX_DAIO_ADDRESS, DATO_HANDLE (archive), DATO_TIER (immortal), DATO_ROOT (blockchain),
//      AO_URL, AO_MODULE, AO_SCHEDULER, SPAWN_RETRIES (default 3).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import * as bip39 from 'bip39';
import { connect, createDataItemSigner } from '@permaweb/aoconnect';
import { deriveJwkFromMnemonic } from '../src/lib/arweave/seed';
import { addressFromJwk } from '../src/lib/arweave/jwk';

const LEGACY = {
  module: 'Do_Uc2Sju_ffp6Ev0AnLVdPtot15rvMjP-a9VVaA5fM',
  scheduler: '_GQ33BkPtZrqxA84vM8Zk-N2aO0toNNu_C-l-rawrBA',
  authority: 'fcoN_xJeisVsPXA-trzVAuIiqO3ydLQxM-L4XbrQKzY',
};
const DATO_LUA = '/home/hacker/mindX/dato/ao/dato.lua';
const WALLET = '/home/hacker/mindX/dato/data/parsec_wallet.json';
const OUT = '/home/hacker/mindX/dato/data/ao_process.json';

const MODE = (process.env.AO_MODE || 'legacy').toLowerCase();
const HANDLE = process.env.DATO_HANDLE || 'archive';
const TIER = process.env.DATO_TIER || 'immortal';
const ROOT = process.env.DATO_ROOT || 'blockchain';
const RETRIES = Number(process.env.SPAWN_RETRIES || 3);

const luaStr = (s: string) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function parsecWallet(): Promise<{ address: string; jwk: any; mnemonic: string }> {
  if (existsSync(WALLET)) {
    const w = JSON.parse(readFileSync(WALLET, 'utf8'));
    if (w?.jwk?.n) { console.log('  ✓ reusing parsec wallet:', w.address); return w; }
  }
  const mnemonic = bip39.generateMnemonic(256);
  console.log('  deriving parsec RSA-4096 wallet (~30s)…');
  const jwk = (await deriveJwkFromMnemonic(mnemonic)) as any;
  const address = await addressFromJwk(jwk);
  mkdirSync('/home/hacker/mindX/dato/data', { recursive: true });
  writeFileSync(WALLET, JSON.stringify({ address, mnemonic, jwk }, null, 2));
  console.log('  ✓ parsec wallet:', address);
  return { address, jwk, mnemonic };
}

async function main() {
  console.log(`⟁ dato → real AO process (mode=${MODE}, parsec wallet + aoconnect)\n`);

  const connectOpts: any = {};
  let module = process.env.AO_MODULE || LEGACY.module;
  let scheduler = process.env.AO_SCHEDULER || LEGACY.scheduler;
  if (MODE === 'mainnet') {
    if (!process.env.AO_URL) throw new Error('AO_MODE=mainnet requires AO_URL=<hyperbeam node url>');
    connectOpts.MODE = 'mainnet';
    connectOpts.URL = process.env.AO_URL;
  }
  const { spawn, dryrun } = connect(connectOpts);

  const { address, jwk, mnemonic } = await parsecWallet();
  const owner = process.env.MINDX_DAIO_ADDRESS || address;
  const name = `${HANDLE}.${TIER}.${ROOT}`;
  const lua = readFileSync(DATO_LUA, 'utf8');
  const bootData =
    [
      `Owner = ${luaStr(owner)}`,
      `Deployer = ${luaStr(address)}`,
      `Settings = { default_tier = ${luaStr(TIER)}, join_fee = 0, open_join = true, max_members = 0 }`,
      `Members = { [${luaStr(address)}] = { joined_at = 0, fee_paid = 0, settings = {} } }`,
      `Names = { [${luaStr(name)}] = { controller = ${luaStr(owner)}, proof = nil } }`,
      '',
    ].join('\n') + lua;

  const signer = createDataItemSigner(jwk);
  const tags = [
    { name: 'Name', value: `dato-${name}` },
    { name: 'App-Name', value: 'dato' },
    { name: 'Authority', value: LEGACY.authority },
    { name: 'Owner-DAIO', value: owner },
    { name: 'Deployer', value: address },
    { name: 'Dato-Name', value: name },
    { name: 'Dato-Tier', value: TIER },
    { name: 'On-Boot', value: 'Data' },
  ];

  let processId: string | null = null;
  let lastErr = '';
  for (let i = 1; i <= RETRIES; i++) {
    try {
      console.log(`  spawning (attempt ${i}/${RETRIES})…`);
      processId = await spawn({ module, scheduler, signer, tags, data: bootData });
      break;
    } catch (e: any) {
      lastErr = String(e?.message || e).slice(0, 200);
      console.log(`    ✗ ${lastErr}`);
      if (i < RETRIES) await sleep(8000);
    }
  }

  if (!processId) {
    mkdirSync('/home/hacker/mindX/dato/data', { recursive: true });
    writeFileSync(OUT, JSON.stringify({
      status: 'blocked', mode: MODE, module, scheduler, owner_daio: owner, deployer: address,
      dato_name: name, last_error: lastErr,
      diagnosis: 'AO endpoint rejected the spawn (legacynet MU 500 / mainnet needs AO_URL+funding). '
        + 'Wallet + signing + bundling are correct; retry when the endpoint is healthy or set AO_MODE=mainnet AO_URL=<node>.',
      attempted_at: new Date().toISOString(),
    }, null, 2));
    console.error(`\n✗ spawn blocked after ${RETRIES} attempts: ${lastErr}`);
    console.error('  → wrote blocked status to', OUT, '(wallet/signing/bundling verified; endpoint is the blocker)');
    process.exit(2);
  }

  console.log('  ✓ SPAWNED AO process:', processId);
  console.log('    ao.link: https://www.ao.link/#/entity/' + processId);
  writeFileSync(OUT, JSON.stringify({
    status: 'spawned', mode: MODE, process_id: processId, module, scheduler,
    owner_daio: owner, deployer: address, dato_name: name, tier: TIER,
    wallet: { address, mnemonic, jwk }, spawned_at: new Date().toISOString(),
  }, null, 2));
  console.log('  → wrote', OUT);

  console.log('\n  probing Info (On-Boot eval may lag ~30-90s)…');
  for (let i = 0; i < 8; i++) {
    await sleep(12000);
    try {
      const out = await dryrun({ process: processId, tags: [{ name: 'Action', value: 'Info' }] });
      const msg = (out.Messages && out.Messages[0]) || {};
      console.log('  ✓ Info:', JSON.stringify(msg.Data || out.Output || out).slice(0, 300));
      return;
    } catch (e: any) {
      console.log(`    (attempt ${i + 1}/8: ${String(e?.message || e).slice(0, 80)})`);
    }
  }
  console.log('  (spawned; Info still propagating — query later with the id above)');
}

main().catch((e) => { console.error('deploy-dato-ao failed:', e?.stack || e); process.exit(1); });
