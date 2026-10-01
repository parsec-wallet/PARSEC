# PARSEC — the cypherpunk Tier-Q flagship (Algorand track)

PARSEC is the reference **sovereign, client-side, per-connection-keypair** wallet under
**[CP2048-QR](https://github.com/cypherpunk2048)** — and the project where the cypherpunk lineage first
earns **Tier-Q (quantum-native)**, on **Algorand**. Tier-Q carries forward into **cypherpunk4096**
(2¹², the strict superset that LUV/DeltaVerse now build to): cp4096 commitment #5 is *quantum
compliance* — signatures handled as `bytes`, never `(v,r,s)`, scheme-migratable behind a timelock — and
PARSEC is where that commitment is realized in a live wallet. This is the Algorand track, **separate
from the ETHGlobal/EVM submission**.

> Grounded in **[Algorand's Post-Quantum Cryptography Roadmap](https://algorand.co/blog/algorand-post-quantum-cryptography-roadmap)**
> (read 2026-08-20). This file tracks that roadmap; re-check it before shipping any PQ claim.

## Self-certification (per CP2048-QR §6), today

| Property | PARSEC today |
|---|---|
| **Sovereignty** | ✅ client-side keys, open-source, **per-connection keypairs**, zeroized after signing (§3 conformant) |
| **Signatures today** | ed25519 (Algorand/Solana), secp256k1 (EVM), RSA-4096 (Arweave) — **classical** |
| **Symmetric / hash** | AES-256-GCM, SHA-512; PBKDF2-600k (web) / Argon2id (desktop vault) — Grover-survivable |
| **Tier today** | **Tier-C** on signatures (sovereign custody, classical schemes) |
| **Tier target** | **Tier-Q** on Algorand (account/signature layer — see the honest scope below) |

## What Algorand's roadmap actually delivers, and when

Account-level post-quantum is arriving as a **native, standards-tracked** capability — not a bolt-on.
The pieces that matter for a wallet:

- **Native Falcon-1024 accounts — Q3 2026.** Supersedes the LogicSig-only Falcon pattern (the 2025
  first-PQ-transaction proof). Native address derivation is
  `SHA512_256(domain ‖ scheme[2] ‖ explicit_salt[1] ‖ pk)`, **preserving the 32-byte address / 58-char
  format**, and Falcon-1024 is **derivable from the standard 25-word seed** — so a PQ account looks and
  seeds like a normal Algorand account. **Legacy SDKs, Pera Wallet, and AlgoKit will support it.**
- **Cryptographic agility — Q3 2026.** Network-level support for **multiple concurrent signature
  schemes** (Ed25519 alongside Falcon; FN-DSA, ML-DSA, others under the agility framework), with no
  further structural overhaul to add a scheme. This is the substrate version of cp4096 #5.
- **Hybrid accounts.** "Any combination of keys" — merge an ECC account with a lattice one for defense
  against both classical and quantum risk. This is PARSEC's cutover path (run ed25519 + Falcon together).
- **Native PQ multisig — end 2026.** A **generic policy layer over independently-verifiable
  signatures** (weighted approvals, hybrid classical+PQ signers), not scheme-specific threshold crypto.
- **Falcon-512 — end 2026.** Smaller keys/sigs for cheaper accounts.
- **State Proofs (Falcon)** already give **quantum-secure finality / light-client proofs** today.

**Key/sig sizes (the concrete reason cp4096 forbids `(v,r,s)`):**

| Scheme | Public key | Signature |
|---|---|---|
| Ed25519 | 32 B | 64 B |
| Falcon-512 | 897 B | ~640 B |
| Falcon-1024 | 1793 B | ~1280 B |

A Falcon signature is **640–1280 bytes** — it cannot fit the 65-byte `(v,r,s)` shape, which is exactly
why cp4096 mandates signatures be carried as `bytes`. The roadmap is the empirical justification for
that commitment.

## Honest scope — account-layer PQ ≠ whole-network PQ (yet)

State this plainly wherever PARSEC claims Tier-Q:

- **Accounts/signatures: quantum-resistant is reachable now** (Falcon LogicSig today, native Q3 2026).
- **Consensus is still Ed25519** — voter signatures and the **ECC VRF** (cryptographic sortition) are
  not yet quantum-resistant. Algorand's PQ-consensus + VRF-replacement research paper is **expected
  early 2027**; PQ consensus messaging details **late 2026**. State Proofs cover finality *proofs*, not
  live voting.
- So PARSEC on the Algorand track is **Tier-Q at the account/signature layer**, on a network whose
  consensus quantum-resistance is on the roadmap but not shipped. Label it that precisely — never
  "quantum-proof wallet" full stop.

## Path to Tier-Q (revised to the roadmap)

1. **Falcon (FN-DSA) keypair per connection**, client-side, open-source — use **FALCON-DET1024**
   (deterministic, **integer-only** keygen, no floating point; the variant Algorand's Trezor Safe 5 PoC
   ships: ~2.2 s keygen, ~0.69 s sign). Floating-point Falcon is an implementation hazard; the wallet
   uses the integer-only path.
2. **Target NATIVE Falcon-1024 accounts** (Q3 2026), derived from the **standard 25-word seed** via the
   native derivation above — **not** a bespoke LogicSig. PARSEC inherits this the same way it inherits
   Algorand support generally: **from Pera Wallet's code** (Pera is a named roadmap supporter), matching
   PARSEC's canonical-wallet-as-example compatibility model (Pera→Algorand, Phantom→Solana,
   MetaMask→EVM). Keep the LogicSig path as the pre-Q3-2026 fallback.
3. **Hybrid through the cutover** — an ed25519 + Falcon hybrid account so a connection is safe against
   both adversaries during transition; drop ed25519 only when native PQ is battle-tested.
4. **Anchor** identity/session commitments to Algorand **State Proofs** (quantum-secure finality).
5. **PQ multisig** for the OVERLORD / DAIO 2-of-3 surfaces via Algorand's generic-policy multisig
   (end 2026) — weighted, hybrid classical+PQ signers.
6. **Vault stores `bytes`, not `(v,r,s)`** — the bankon_vault keyring already holds raw key material
   across architectures (ed25519 · secp256k1 · RSA-4096); add Falcon as another `bytes` scheme, no
   format assumption that a signature is 65 bytes.

## Milestones (Algorand roadmap, dated)

| Date | Milestone | PARSEC action |
|---|---|---|
| 2025 | First PQC-secured mainnet transaction (Falcon via LogicSig) | LogicSig Falcon path = the fallback |
| **Q3 2026** | Native Falcon-1024 accounts · cryptographic agility · multi-scheme network support | Ship native Falcon-1024 from 25-word seed (via Pera code) |
| **End 2026** | Falcon-512 · native PQ multisig | Falcon-512 accounts; PQ 2-of-3 for OVERLORD/DAIO |
| **Late 2026** | PQ consensus-messaging details | Update honest-scope note |
| **Early 2027** | PQ VRF / consensus research paper | Re-assess consensus-layer Tier-Q claim |

## cypherpunk4096 alignment

The roadmap is a point-for-point substrate realization of cp4096's quantum commitment (#5), and PARSEC
is the wallet that consumes it:

- **`bytes`, never `(v,r,s)`** ↔ Falcon sigs are 640–1280 B. The vault, the signer interface, and any
  on-chain verifier PARSEC touches must treat a signature as opaque `bytes`.
- **Scheme-migratable behind a timelock** ↔ Algorand's **cryptographic-agility framework** (concurrent
  schemes, add-without-overhaul). cp4096's timelocked scheme swap is the contract-layer mirror of
  Algorand's network-layer agility; the bankonvault lockers' `i_signature_verifier` crypto-agility seam
  is the same idea one layer down.
- **Hybrid classical+PQ** ↔ Algorand hybrid accounts + hybrid multisig — the honest migration posture
  cp4096 asks for (never claim PQ before the PQ scheme is live and battle-tested).
- **Determinism / no approximation** ↔ FALCON-DET1024 integer-only keygen (no floating-point
  nondeterminism), which is also what makes a hardware-wallet and cross-device implementation reproducible.

PARSEC is itself sovereign and (on the Algorand track) heading to quantum-resistant accounts, **modularly
attaching to external, non-sovereign wallets** while each connection holds its own client-side keypair —
the reference shape of CP2048-QR §3, carried into cp4096. See `RAILS.md` in the standard.
