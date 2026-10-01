# aORC — Algorand Open Runtime Contracts

> NFT minting infrastructure for ARC-3 / ARC-19 / ARC-69 assets on Algorand,
> including contract-generated types.

## Overview

aORC (Algorand Open Runtime Contracts) is PARSEC's NFT minting layer. It builds
and submits mint transactions for the standard Algorand NFT ARCs and adds a
**TypeMinter** for on-chain, contract-generated asset types.

- **ARC-3 / ARC-19 / ARC-69** — the metadata standards PARSEC mints and reads.
- **TypeMinter** — mint instances of a type defined on-chain by an aORC
  contract, rather than ad-hoc per-asset metadata.

## Status

The aORC contracts are deployed and verified on **Algorand testnet**; the
TypeScript clients live in `src/lib/aorc/`.

## Key files

- `src/lib/aorc/` — barrel + mint clients (`index.ts` re-exports the surface
  every view consumes).
- NFT metadata reading is shared with the Algorand chain pack
  (`src/lib/algorand/nft-metadata.ts`, `nft-arc19.ts`).

## Notes

aORC mints land as Algorand Standard Assets, so a minted NFT appears in the
normal ASA list on the Algorand dashboard.
