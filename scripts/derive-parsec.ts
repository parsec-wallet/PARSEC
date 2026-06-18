import { writeFileSync } from 'node:fs';
import * as bip39 from 'bip39';
import { deriveJwkFromMnemonic } from '../src/lib/arweave/seed';
import { addressFromJwk } from '../src/lib/arweave/jwk';
async function main() {
  const mnemonic = bip39.generateMnemonic(256);
  const jwk: any = await deriveJwkFromMnemonic(mnemonic);
  const address = await addressFromJwk(jwk);
  writeFileSync('/home/hacker/mindX/dato/data/parsec_wallet.json', JSON.stringify({ address, mnemonic, jwk }, null, 2));
  writeFileSync('/tmp/parsec_jwk.json', JSON.stringify(jwk));
  console.log('PARSEC_WALLET_ADDRESS=' + address);
}
main().catch((e) => { console.error(e); process.exit(1); });
