#!/usr/bin/env node
// Re-derive every entry of PARSEC's verified Algorand asset list from the chain.
//
//   node scripts/asa-whitelist-check.mjs                  check: live indexer + Pera vs the list and its snapshot
//   node scripts/asa-whitelist-check.mjs --write-snapshot  refresh the snapshot (only when every entry matches the chain)
//
// For each entry it reads the asset from the network's indexer and (mainnet) Pera's
// verification tier, and fails on any difference in id, creator, unit, on-chain name,
// decimals, freeze or clawback rights, on a deleted asset, or on a tier other than
// "verified"/"trusted". It also reports drift from the committed snapshot (a changed
// manager, reserve, url or total). Zero dependencies; Node 20+ (global fetch).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const LIST = path.join(here, '../src/lib/algorand/asset-whitelist.json');
const SNAP = path.join(here, '../src/lib/algorand/asset-whitelist.snapshot.json');
const ZERO = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ';
const INDEXER = { mainnet: 'https://mainnet-idx.algonode.cloud', testnet: 'https://testnet-idx.algonode.cloud' };
const PERA = 'https://mainnet.api.perawallet.app/v1/public/assets';

async function text(url) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'parsec-asa-whitelist-check' }, signal: AbortSignal.timeout(25_000) });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.text();
    } catch (e) {
      if (i >= 2) throw e;
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
  }
}

const json = async (url) => JSON.parse(await text(url));

const addr = (a) => (a && a !== ZERO ? a : null);

/** What the chain (and Pera) say about one asset — the snapshot record. */
async function observe(network, assetId) {
  const raw = await text(`${INDEXER[network]}/v2/assets/${assetId}`);
  const { asset } = JSON.parse(raw);
  const p = asset.params;
  // `total` is a u64; JSON.parse would round anything past 2^53 to a float. Read the digits.
  const total = /"total"\s*:\s*(\d+)/.exec(raw)?.[1] ?? String(p.total);
  const rec = {
    assetId,
    deleted: Boolean(asset.deleted),
    unitName: p['unit-name'] ?? '',
    name: p.name ?? '',
    decimals: p.decimals,
    creator: p.creator,
    total,
    manager: addr(p.manager),
    reserve: addr(p.reserve),
    freeze: addr(p.freeze),
    clawback: addr(p.clawback),
    url: p.url ?? '',
  };
  if (network === 'mainnet') rec.peraTier = (await json(`${PERA}/${assetId}/`)).verification_tier ?? null;
  return rec;
}

const list = JSON.parse(fs.readFileSync(LIST, 'utf8'));
const snap = fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, 'utf8')) : null;
const write = process.argv.includes('--write-snapshot');

const problems = [];
const drift = [];
const fresh = { $comment: 'What the indexer and Pera reported for each listed asset. Written by scripts/asa-whitelist-check.mjs --write-snapshot; do not edit by hand.', taken: new Date().toISOString().slice(0, 10) };

for (const network of ['mainnet', 'testnet']) {
  fresh[network] = {};
  for (const e of list[network] ?? []) {
    const o = await observe(network, e.assetId);
    fresh[network][e.assetId] = o;
    const where = `${network} ${e.assetId} ${e.unitName}`;
    if (o.deleted) problems.push(`${where}: deleted on chain`);
    for (const k of ['unitName', 'name', 'decimals', 'creator']) {
      if (o[k] !== e[k]) problems.push(`${where}: ${k} is ${JSON.stringify(o[k])} on chain, list says ${JSON.stringify(e[k])}`);
    }
    if (Boolean(o.freeze) !== e.freeze) problems.push(`${where}: freeze rights ${Boolean(o.freeze)} on chain, list says ${e.freeze}`);
    if (Boolean(o.clawback) !== e.clawback) problems.push(`${where}: clawback rights ${Boolean(o.clawback)} on chain, list says ${e.clawback}`);
    if (network === 'mainnet' && !['verified', 'trusted'].includes(o.peraTier)) problems.push(`${where}: Pera tier is ${o.peraTier}`);
    const before = snap?.[network]?.[e.assetId];
    if (!before) drift.push(`${where}: not in the snapshot yet`);
    else for (const k of Object.keys(o)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(o[k])) drift.push(`${where}: ${k} was ${JSON.stringify(before[k])}, now ${JSON.stringify(o[k])}`);
    }
  }
}

const n = (list.mainnet?.length ?? 0) + (list.testnet?.length ?? 0);
for (const p of problems) console.error(`MISMATCH  ${p}`);
for (const d of drift) console.error(`DRIFT     ${d}`);
if (problems.length) {
  console.error(`\n${problems.length} mismatch(es) in ${n} entries — fix the list (or remove the entry) before anything else.`);
  process.exit(1);
}
if (write) {
  fs.writeFileSync(SNAP, JSON.stringify(fresh, null, 2) + '\n');
  console.log(`${n} entries match the chain; snapshot written.`);
} else if (drift.length) {
  console.error(`\n${n} entries match the chain, but ${drift.length} field(s) drifted from the snapshot — review, then --write-snapshot.`);
  process.exit(1);
} else {
  console.log(`${n} entries match the chain and the snapshot.`);
}
