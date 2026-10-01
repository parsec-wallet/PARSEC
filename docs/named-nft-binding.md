# Named-NFT Binding — Spec v0

A small, namespace-agnostic spec for binding Algorand ASAs to ArNS / BANKON names.

## Why

When you mint an NFT on Algorand and own a name on either the AR.IO Network Registry or the BANKON Names Registry, you want the name to surface the NFT. Resolvers (gateways, indexers, dApps) need a consistent way to discover the binding.

This spec keeps the on-chain state minimal: the name's record points at an Arweave-side JSON blob, and that blob carries the Algorand asset id and provenance.

## Binding shape

1. Parsec mints the ASA on Algorand (`signAndSendMint` for ARC-3/19/69 or `signAndSendTypeMint` for aORC types).
2. Parsec uploads a JSON proof to Arweave with the tags:

```
Content-Type: application/json
App-Name: parsec-wallet
App-Version: 0.1.0
Type: named-nft-binding
Namespace: arns | bankon
Name: <the name>
Algorand-Asset-Id: <integer>
Algorand-Network: mainnet | testnet | betanet
```

JSON body:

```json
{
  "chain": "algorand",
  "network": "mainnet",
  "assetId": 12345678,
  "asaCreator": "ALGO_CREATOR_ADDRESS",
  "mintTxId": "ALGORAND_MINT_TXID",
  "standard": "arc-3 | arc-19 | arc-69 | aNFT | dNFT | iNFT | THOT",
  "traits": [{ "key": "...", "value": "..." }],
  "name": "...",
  "namespace": "arns | bankon",
  "boundAt": 1747363200000
}
```

3. Parsec writes a record on the name's owning process pointing at that Arweave tx-id:
   - **ArNS**: `Set-Record` on the ANT process with the chosen `Sub-Domain` (default `@asa`).
   - **BANKON**: `Set-Record` on the BNR with the same shape.

## Subdomain naming convention

- `@asa` → the primary asset bound to the name. Gateways treat this as "this name's NFT."
- `asa-<assetId>` → a secondary binding (for names that anchor multiple assets).
- Any other free-form subdomain works; resolvers should at minimum look up `@asa`.

## Resolution

A resolver fetches the name's record. The `Transaction-Id` field points to an Arweave tx; the resolver downloads it, parses the JSON, and gets the Algorand asset id (plus network + creator + provenance). From there it can fetch the asset's metadata via algod, render the NFT, etc.

## Why not put the asset id directly in the record

We could put `Algorand-Asset-Id: 12345678` straight into the record's `Transaction-Id` field, but that field is typed as a 43-char Arweave tx-id by gateways. Stuffing a small integer in there breaks gateway-level resolution. Using an Arweave tx-id as the indirection keeps everything compatible with existing gateways and adds the upside of an immutable, archival proof.

## Authentication

The Arweave-side proof is signed by the name's owner. Resolvers can verify the binding by:

1. Confirming the Arweave tx owner matches the name's owner (via the ANT or BNR owner field).
2. Confirming the Algorand asset's creator matches `asaCreator`.

That gives end-to-end authentication: only the owner of the name can produce a valid binding, and only the creator of the asset can produce a binding pointing at that asset.

## Versioning

This is v0. Future versions might add:
- Cross-chain bindings beyond Algorand (Solana mint id, Ethereum contract address, …).
- Encrypted bindings (asset id stays private; only authorized parties can resolve).
- Signed update chains so the binding can rotate without rewriting the record.

For now: keep it simple, JSON, one record per binding.
