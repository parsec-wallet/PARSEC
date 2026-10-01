# Security documentation

| Document | What it covers |
|---|---|
| [`threat-model.md`](threat-model.md) | What Parsec defends against and what it does not, attacker by attacker |
| [`bankon-vault-spec.md`](bankon-vault-spec.md) | The `bankon-vault/2` format, normatively — the contract other projects build against |
| [`vault-family.md`](vault-family.md) | The five codebases named "bankon vault", which is canonical for what, and what interoperates |
| [`memory-hygiene.md`](memory-hygiene.md) | The `secure_mem.rs` contract and the rules for handling key material |
| [`reference-wallets.md`](reference-wallets.md) | MetaMask, Pera, Bitcoin Core and BANKONBTCWaaS, source-verified with links |
| [`provenance.md`](provenance.md) | Every external source that shaped this code, what was taken from it, and where it lands — licence compliance and audit trail |

The disclosure process is in [`../../SECURITY.md`](../../SECURITY.md).
