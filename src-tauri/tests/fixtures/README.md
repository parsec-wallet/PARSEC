# Test fixtures

`bankon-vault-1/` is a `bankon-vault/1` vault written by PARSEC's v1 store, committed as bytes so
`the_committed_v1_vault_migrates_with_every_secret` (in `src/bankon_vault/vault.rs`) can migrate a
real v1 vault on every test run. Passphrase: `parsec-v1-fixture-2026`.

**Every key in it is a well-known public test key** (the BIP-39 "abandon … about" and
"legal winner …" vectors, `0x11…11`, a placeholder JWK). Never send funds to these addresses.
