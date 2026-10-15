// SMART domain BUY NOW — the name found in the RAGEbar, bought at one set.price.
//
// The RAGEbar (the Matrix's search) spots a name and shows its price; BUY NOW lands here, in the live
// wallet, because the Blue Pill holds no keys. One price, take it or leave it (lib/ui/offer.ts):
// preflight → the BANKON markup over x402 → the permabuy signed by the account's Solana key → the name's
// controller, where its page and its iNFT are next. See lib/names/smart-domain.ts for the rules.

import { el, btn, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { openOffer } from '../lib/ui/offer';
import { signersForAccount } from '../lib/x402/adapters/parsec';
import { fetchPricesByIds } from '../lib/prices';
import { usdRateMicro } from '../lib/permaweb/storage-cost';
import * as arns from '../lib/arweave/solana-arns-client';
import { readArio } from '../lib/permaweb/client';
import {
  formatUsd,
  quoteSmartDomain,
  smartDomainQuery,
  type SmartDomainDeps,
  type SmartDomainQuote,
} from '../lib/names/smart-domain';
import { payMarkup } from '../lib/names/smart-domain-pay';

const C = 'parsec-smartdomain';
export const SMART_DOMAIN_KEY = 'parsec:smart-domain';

export const smartDomainDeps: SmartDomainDeps = {
  getRecord: (n) => arns.getRecord(n),
  isReserved: (n) => arns.isReserved(n),
  permabuyCost: (n) => arns.getCost({ intent: 'Buy-Name', name: n, purchaseType: 'permabuy' }),
  arioUsdMicro: async () => {
    const c = await fetchPricesByIds(['ar-io-network']).catch(() => []);
    const r = usdRateMicro(c.find((x) => x.id === 'ar-io-network')?.usd);
    return r && r > 0n ? r : null;
  },
};

function ario(mario: bigint): string {
  const whole = mario / 1_000_000n;
  const frac = (mario % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${frac ? `.${frac}` : ''} ARIO`;
}

export function smartDomainView(): HTMLElement {
  let pending: string | null = null;
  try { pending = sessionStorage.getItem(SMART_DOMAIN_KEY); } catch { pending = null; }
  const name = smartDomainQuery(pending ?? '') ?? '';

  const root = el('div', { cls: `parsec-view parsec-confirm ${C}` });
  root.appendChild(el('div', { cls: 'parsec-view__header', children: [
    btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('matrix') }),
    el('h2', { cls: 'parsec-view__title', text: name ? `${name}.ar.io` : 'SMART domain' }),
  ] }));
  const body = el('div', { cls: `${C}__body` });
  root.appendChild(body);

  if (!name) { body.appendChild(el('p', { cls: 'parsec-empty', text: 'Search a name in the RAGEbar to buy it.' })); return root; }

  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const sol = account ? getAccountAddress(account, 'solana') : undefined;
  if (!store.getPassphrase()) {
    body.appendChild(el('p', { cls: 'parsec-view__desc', text: 'Unlock the wallet to buy — the name is bought by your own key.' }));
    body.appendChild(btn('Unlock', { intent: 'primary', icon: 'unlock', onClick: () => store.navigate('unlock') }));
    return root;
  }
  if (!account || !sol) {
    body.appendChild(el('p', { cls: 'parsec-view__desc', text: 'A SMART domain is owned by a Solana key. Add one to this account to buy.' }));
    body.appendChild(btn('Import Solana key', { intent: 'primary', icon: 'import', onClick: () => store.navigate('solana-import') }));
    return root;
  }

  body.appendChild(el('p', { cls: 'parsec-view__desc', text: 'Reading the price…' }));
  void (async () => {
    let q: SmartDomainQuote;
    try { q = await quoteSmartDomain(name, smartDomainDeps); } catch (e) {
      body.replaceChildren(el('p', { cls: 'parsec-view__desc', text: `The ar.io registry could not be read: ${e instanceof Error ? e.message : String(e)}` }));
      return;
    }
    body.replaceChildren();
    if (!q.available) {
      body.appendChild(el('p', { cls: 'parsec-view__desc', text: q.reserved ? `${name} is reserved by the protocol.` : `${name} is already owned.` }));
      return;
    }
    if (q.setPriceMicroUsd == null || q.markupMicroUsd == null || q.costMario === undefined) {
      body.appendChild(el('p', { cls: 'parsec-view__desc', text: 'ARIO\'s price could not be read, so there is no price to offer right now. Try again in a moment.' }));
      return;
    }
    const price = formatUsd(q.setPriceMicroUsd);
    body.append(
      el('div', { cls: `${C}__price`, text: price }),
      el('p', { cls: 'parsec-view__desc', text: `${name}.ar.io — permanent (permabuy), owned by your Solana key ${sol.slice(0, 4)}…${sol.slice(-4)}.` }),
      btn('BUY NOW', { intent: 'primary', icon: 'shopping-cart', onClick: () => offer(q, price) }),
    );
  })();

  function offer(q: SmartDomainQuote, price: string): void {
    openOffer({
      kicker: 'Price',
      price,
      detail: `${name}.ar.io · permanent · yours`,
      fine: `Signed by your Solana key; paid over x402 and in ARIO (${ario(q.costMario!)}).`,
      buyLabel: 'Buy',
      onBuy: async () => {
        const passphrase = store.getPassphrase();
        if (!passphrase) throw new Error('The wallet locked. Unlock and try again.');
        // 1. preflight: still free, and the key holds the ARIO
        const again = await quoteSmartDomain(name, smartDomainDeps);
        if (!again.available) throw new Error(`${name} was just taken. Nothing was paid.`);
        const bal = BigInt(String(await (await readArio() as unknown as { getBalance(o: { address: string }): Promise<number | bigint> }).getBalance({ address: sol! })));
        if (bal < again.costMario!) throw new Error(`Your Solana key holds ${ario(bal)}; this name needs ${ario(again.costMario!)}. Nothing was paid.`);
        // 2. the markup, over x402
        await payMarkup(name, signersForAccount(account!), q.markupMicroUsd!);
        // 3. the permabuy, signed by the account's Solana key
        await arns.buyName({ address: sol!, passphrase, name, purchaseType: 'permabuy' });
        try { sessionStorage.removeItem(SMART_DOMAIN_KEY); sessionStorage.setItem('parsec:active-name', name); } catch { /* fine */ }
        toast(`${name}.ar.io is yours — give it a page next`, 'success');
        store.navigate('name-controller');
      },
      onLeave: () => { try { sessionStorage.removeItem(SMART_DOMAIN_KEY); } catch { /* fine */ } store.navigate('matrix'); },
    });
  }
  return root;
}
