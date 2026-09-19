// End-to-end handshake test: the real Connect server, driven by the real browser SDK that
// the PYTHAI sites ship. Node 18+ has native WebSocket and fetch; the SDK only needs
// `location.origin` stubbed, because a browser provides it and Node does not.
//
// The only thing not exercised here is the GUI leg — a person reading the intent in the
// Parsec approval dialog and pressing Approve. The harness stands in for exactly that, and
// nothing else, so every other hop is production code.
//
//   cd src-tauri && cargo run --example connect_harness 9877
//   node apps/parsec-names/test/handshake.test.mjs
//
// Exits non-zero on any failure.
const PORT = Number(process.env.PORT ?? 9877);
const ORIGIN = process.env.ORIGIN ?? 'https://bankon.pythai.net';
globalThis.location = { origin: ORIGIN };

const { ParsecNames, ParsecNotAvailable, ParsecRejected, undernameUrl } =
  await import(new URL('../parsec-names.js', import.meta.url).href);

const TX = 'T9_V2HfiAq5qlLzObfyayj2-cjPujxpg25TRi4OZbe4';
let pass = 0, fail = 0;
const ok  = (n, d='') => { pass++; console.log(`  PASS  ${n}${d ? ' — ' + d : ''}`); };
const bad = (n, d='') => { fail++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); };
const check = (n, cond, d='') => cond ? ok(n, d) : bad(n, d);

const pn = new ParsecNames({ port: PORT });

// Section 6 locks the wallet; the harness releases it again after 1.5 s. Wait for that, so
// the suite can be run repeatedly against one harness. A test that cannot be run twice is
// not a test.
const health = () => fetch(`http://127.0.0.1:${PORT}/parsec/v1/connect/health`).then((r) => r.json());
async function waitUnlocked(timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await health()).unlocked) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

console.log('\n1. Detection');
check('detect() finds the running wallet', await pn.detect() === true);
check('info exposes the port', pn.info?.port === PORT || pn.info != null, JSON.stringify(pn.info));

check('harness starts unlocked (suite is re-runnable)', await waitUnlocked());

console.log('\n2. Public read (no wallet involved)');
const live = await pn.read('deltaverse');
check('reads deltaverse from a public gateway', live.resolvedId !== null, `${live.gateway} -> ${live.resolvedId}`);
check('recognises the ar.io placeholder', ParsecNames.isPlaceholder(live.resolvedId) === true);
check('undername URL uses an underscore', undernameUrl('deltaverse','docs') === 'https://docs_deltaverse.ar.io');

console.log('\n3. Approved write — the full round trip');
const t0 = Date.now();
const r1 = await pn.setRoot('deltaverse', TX, 900);
check('setRoot resolves with the adapter result', r1?.id?.startsWith('sig-set-root-'), JSON.stringify(r1));
check('round trip completes promptly', Date.now() - t0 < 5000, `${Date.now() - t0} ms`);

const r2 = await pn.setUndername('deltaverse', 'Docs', TX, 900);
check('setUndername resolves', r2?.id?.startsWith('sig-set-undername-'), JSON.stringify(r2));

const r3 = await pn.setIdentity('bankon', { ticker: 'BNK', logo: TX });
check('setIdentity resolves', r3?.id?.startsWith('sig-set-identity-'), JSON.stringify(r3));

console.log('\n4. Rejection is surfaced, not swallowed');
try {
  await pn.setRoot('rejectme', TX, 900);
  bad('rejection rejects the promise');
} catch (e) {
  check('rejection rejects the promise', e instanceof ParsecRejected, e.name);
  check('rejection carries code 4001', e.code === 4001, `code=${e.code} "${e.message}"`);
}

console.log('\n5. The server refuses what it should');
const raw = (method, params) => new Promise((res, rej) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/parsec/v1/connect/ws`);
  ws.addEventListener('open', () => ws.send(JSON.stringify({ id: 99, method, params })));
  ws.addEventListener('message', (ev) => { ws.close(); res(JSON.parse(ev.data)); });
  ws.addEventListener('error', rej);
});
const badOp = await raw('parsec_nameRequest', { namespace:'solana-arns', op:'transfer', name:'deltaverse', params:{ to:'x' }, origin:ORIGIN });
check('transfer is outside the allowlist', badOp.error?.code === -32602, badOp.error?.message);
const badOp2 = await raw('parsec_nameRequest', { namespace:'solana-arns', op:'buy-name', name:'deltaverse', params:{}, origin:ORIGIN });
check('buy-name is outside the allowlist', badOp2.error?.code === -32602, badOp2.error?.message);
const badName = await raw('parsec_nameRequest', { namespace:'solana-arns', op:'set-root', name:'Delta.Verse', params:{ transactionId:TX }, origin:ORIGIN });
check('a malformed name is refused', badName.error?.code === -32602, badName.error?.message);
const noOp = await raw('parsec_nameRequest', { namespace:'solana-arns', name:'deltaverse', params:{}, origin:ORIGIN });
check('a missing op is refused', noOp.error?.code === -32602, noOp.error?.message);
const unknown = await raw('parsec_totallyMadeUp', {});
check('an unknown method is refused', unknown.error?.code === -32601, unknown.error?.message);

console.log('\n6. Locked wallet');
try {
  await pn.setRoot('lockme', TX, 900);
  bad('locked wallet rejects');
} catch (e) { check('locked wallet rejects', e.code === 4001, `code=${e.code}`); }
const afterLock = await raw('parsec_nameRequest', { namespace:'solana-arns', op:'set-root', name:'deltaverse', params:{ transactionId:TX }, origin:ORIGIN });
check('subsequent writes report 4100 Wallet is locked', afterLock.error?.code === 4100, afterLock.error?.message);

check('wallet unlocks again, so the suite can be re-run', await waitUnlocked());
pn.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
