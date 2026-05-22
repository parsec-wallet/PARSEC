# NFDominter — `.algo` name minting

> In-wallet minting and management of NFD (`.algo`) names, with a BANKON fee
> attached to each mint.

## Overview

NFDominter is Parsec's front end for the **NFD** Algorand Name Service. It
wraps the NFD client in one import surface (`src/lib/nfd/`) and surfaces a
four-tab view (`src/views/nfdominter.ts`):

- **Mint** — search-as-you-type a name, see live tier / availability / price,
  review the cost breakdown (NFD price, contract funding, network fee, BANKON
  fee), then sign the mint.
- **Search** — faceted browser over existing NFDs.
- **Mine** — NFDs owned by the active account.
- **Manage** — quick actions on owned names (link address, set primary).

## Fee model

Each mint attaches a configurable **BANKON fee** alongside the NFD registry
cost. The fee address is set at build time; the mint is skipped with a warning
if it is unconfigured.

## Key files

- `src/lib/nfd/` — `client.ts`, `resolve.ts`, `mint.ts`, `manage.ts`,
  `search.ts`, `validate.ts`, `fees.ts`, `signer.ts`, `types.ts`.
- `src/views/nfdominter*.ts` — entry view + Mint / Search / Manage tabs +
  the review-and-sign confirm screen.

## Notes

NFD names live on Algorand and require the active Algorand account. For
Parsec's *sovereign* permaweb namespace see [BANKON Names](./bankon-names.md);
both are reachable from the unified name hub.
