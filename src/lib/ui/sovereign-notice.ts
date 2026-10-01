// Parsec Wallet — BANKON's notice on sovereign custody.
//
// Shown wherever a vault passphrase is set, entered or abandoned for a new
// vault. It states the one guarantee a self-custody wallet can honestly make:
// nobody holds a copy, so nobody can give one back.

import { el } from '../dom';

export const SOVEREIGN_NOTICE =
  'BANKON guarantees this: if you lose your vault passphrase, no one will help you recover your sovereign identity. '
  + 'Not BANKON, not PARSEC, not anyone. There is no reset, no support desk and no back door. '
  + 'Failure to maintain your wallet private key, recovery phrase and vault passphrase results in loss of funds.';

export function sovereignNotice(): HTMLElement {
  return el('div', {
    cls: 'parsec-callout bp5-callout bp5-intent-danger parsec-sovereign',
    attrs: { role: 'note' },
    children: [
      el('p', { cls: 'parsec-sovereign__from', text: 'From BANKON' }),
      el('p', { text: SOVEREIGN_NOTICE }),
    ],
  });
}
