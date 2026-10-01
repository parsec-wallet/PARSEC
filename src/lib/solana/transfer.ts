// Solana SOL transfer — builds, signs, and submits a legacy transaction by
// hand. Parsec carries no @solana/web3.js dependency: a System Program
// transfer is small enough to assemble from the base58 + ed25519 primitives
// already in the bundle (src/lib/solana/address.ts, @noble/curves).

import { ed25519 } from '@noble/curves/ed25519.js';
import { base58Decode } from './address';
import { deriveSolanaFromMnemonic } from './seed';
import { solanaRpc, LAMPORTS_PER_SOL } from './balance';

// System Program id is 32 zero bytes (base58 "111…11").
const SYSTEM_PROGRAM_ID = new Uint8Array(32);

/** Solana shortvec (compact-u16) length prefix. Exported for unit tests. */
export function compactU16(n: number): Uint8Array {
  const out: number[] = [];
  let v = n;
  for (;;) {
    const b = v & 0x7f;
    v >>>= 7;
    if (v === 0) { out.push(b); break; }
    out.push(b | 0x80);
  }
  return Uint8Array.from(out);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/**
 * Serialize a single-instruction System Program transfer message.
 * Account order follows the Solana rule (signers, then writable, then
 * readonly): [from(signer,writable), to(writable), SystemProgram(readonly)].
 * Exported for unit tests.
 */
export function buildTransferMessage(
  from: Uint8Array,
  to: Uint8Array,
  lamports: bigint,
  blockhash: Uint8Array,
): Uint8Array {
  const header = Uint8Array.from([1, 0, 1]); // 1 sig, 0 ro-signed, 1 ro-unsigned
  const accounts = concat([compactU16(3), from, to, SYSTEM_PROGRAM_ID]);

  // Transfer instruction data: u32 LE selector (2) + u64 LE lamports.
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true);
  dv.setBigUint64(4, lamports, true);

  const instruction = concat([
    Uint8Array.from([2]),                    // program id index → SystemProgram
    compactU16(2), Uint8Array.from([0, 1]),  // account indices: from, to
    compactU16(data.length), data,
  ]);
  return concat([header, accounts, blockhash, compactU16(1), instruction]);
}

/** Build → sign → submit a SOL transfer. Returns the transaction signature. */
export async function sendSol(mnemonic: string, to: string, amountSol: number): Promise<string> {
  const toBytes = base58Decode(to);
  if (toBytes.length !== 32) throw new Error('Invalid Solana recipient address');
  if (!(amountSol > 0)) throw new Error('Amount must be greater than zero');
  const lamports = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));

  const { secretSeed, publicKey } = await deriveSolanaFromMnemonic(mnemonic);
  try {
    const { value } = await solanaRpc<{ value: { blockhash: string } }>(
      'getLatestBlockhash',
      [{ commitment: 'finalized' }],
    );
    const message = buildTransferMessage(publicKey, toBytes, lamports, base58Decode(value.blockhash));
    const signature = ed25519.sign(message, secretSeed);
    const wire = base64(concat([compactU16(1), signature, message]));

    // Preflight: simulate the signed transaction before broadcasting. A
    // malformed message or bad signature fails here — no funds are spent.
    const sim = await solanaRpc<{ value: { err: unknown; logs: string[] | null } }>(
      'simulateTransaction',
      [wire, { encoding: 'base64', sigVerify: true }],
    );
    if (sim.value.err) {
      const logs = (sim.value.logs ?? []).slice(-3).join(' | ');
      throw new Error(
        `Solana simulation failed: ${JSON.stringify(sim.value.err)}${logs ? ` — ${logs}` : ''}`,
      );
    }

    return await solanaRpc<string>('sendTransaction', [wire, { encoding: 'base64' }]);
  } finally {
    secretSeed.fill(0);
  }
}
