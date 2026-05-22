// Subdomains tab — NFD segment minting.
//
// The tab recognizes the account's own .algo names up front (no typing
// needed) and lets the owner mint `label.parent.algo` under any of them —
// even while public minting is locked. A segment can be kept (owner manages
// it) or assigned to another wallet (independent ownership). A name can
// also be opened so anyone may mint; and any open name can be targeted by
// typing it in the secondary field.

import algosdk from 'algosdk';

import { el, btn, input, toast } from '../lib/dom';
import { store } from '../lib/store';
import {
  getMintQuoteWithBankonFee,
  lookupNfd,
  searchByOwner,
  setSegmentLock,
  isSegmentName,
  isSegmentMintingUnlocked,
  canMintSegment,
  type Nfd,
  type NfdMintCostBreakdown,
} from '../lib/nfd';
import type { NetworkId } from '../types/wallet';
import { setNfdPendingMint } from './nfdominter-confirm';
import type { NfdominterTab } from './nfdominter';

const NFD_API: Record<NetworkId, string> = {
  mainnet: 'https://api.nf.domains',
  testnet: 'https://api.testnet.nf.domains',
  betanet: 'https://api.testnet.nf.domains',
};
const DEBOUNCE_MS = 350;
const LABEL_RE = /^[a-z0-9]{1,27}$/;

function algoStr(micro: bigint): string {
  return `${(Number(micro) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })} ALGO`;
}

export function buildSubdomainsTab(
  buyer: string,
  network: NetworkId,
  switchTab: (tab: NfdominterTab) => void,
): HTMLElement {
  // Where the active parent's mint/unlock panels render.
  const action = el('div', { cls: 'parsec-nfdominter__sub-action' });

  // ── Pick the parent name ────────────────────────────────────────────────
  function selectParent(nfd: Nfd, knownOwned: boolean): void {
    action.innerHTML = '';
    const root = nfd.name;
    const unlocked = isSegmentMintingUnlocked(nfd);
    const isOwner = knownOwned || nfd.owner === buyer;
    const canMint = isOwner || canMintSegment(nfd, buyer);

    const status = el('div', { cls: 'parsec-nfdominter__feedback' });
    if (unlocked) status.append(stateChip('subdomains open to all', 'ok'));
    else if (isOwner) status.append(stateChip('you own this name', 'ok'));
    else status.append(stateChip('subdomains locked', 'warn'));
    action.appendChild(status);

    if (canMint) {
      action.appendChild(renderMinter(nfd, root, isOwner));
    } else {
      action.appendChild(el('p', {
        cls: 'parsec-nfdominter__hint',
        text: `${root} has not opened subdomains — only its owner can mint under it.`,
      }));
    }
    if (isOwner && !unlocked) {
      action.appendChild(renderUnlock(nfd, root));
    }
  }

  async function refetchAndSelect(name: string, owned: boolean): Promise<void> {
    try {
      const res = await fetch(`${NFD_API[network]}/nfd/${encodeURIComponent(name)}?view=full`);
      if (res.ok) selectParent((await res.json()) as Nfd, owned);
    } catch { /* keep the current panel */ }
  }

  // ── Owner: open the parent to public subdomains ─────────────────────────
  function renderUnlock(nfd: Nfd, root: string): HTMLElement {
    const priceInput = input({ type: 'number', value: '1', cls: 'bp5-input parsec-nfdominter__price-input' });
    priceInput.min = '0';
    const enableBtn = btn('Open to the public', {
      outlined: true, icon: 'unlock',
      onClick: async () => {
        const pass = store.getPassphrase();
        if (!pass) { toast('Session locked. Unlock first.', 'warning'); return; }
        if (!nfd.appID) { toast('Parent NFD application id unknown.', 'danger'); return; }
        const usd = Math.max(0, Number(priceInput.value) || 0);
        if (!confirm(
          `Open ${root} to public subdomains at $${usd} each?\n\n`
          + 'Anyone will then be able to mint a subdomain under this name. '
          + 'You can re-lock it later. (You can already mint your own subdomains above.)',
        )) return;
        enableBtn.disabled = true;
        try {
          const txid = await setSegmentLock({
            network, nfdAppId: nfd.appID, owner: buyer, passphrase: pass,
            lock: false, usdPriceMicros: BigInt(Math.round(usd * 1_000_000)),
          });
          toast(`Subdomains opened (${txid.slice(0, 8)}…).`, 'success');
          void refetchAndSelect(root, true);
        } catch (e) {
          toast(`Open failed: ${(e as Error).message}`, 'danger');
          enableBtn.disabled = false;
        }
      },
    });
    return el('div', {
      cls: 'parsec-nfdominter__sub-panel',
      children: [
        el('span', { cls: 'parsec-nfdominter__control-label', text: 'Open to the public (optional)' }),
        el('p', { cls: 'parsec-nfdominter__hint', text: `Let anyone — not just you — mint a subdomain under ${root}, at a price you set.` }),
        el('label', { cls: 'parsec-nfdominter__edit-field', children: [
          el('span', { cls: 'parsec-nfdominter__edit-label', text: 'Public subdomain price (USD)' }),
          priceInput,
        ]}),
        enableBtn,
      ],
    });
  }

  // ── Mint a subdomain under the parent ───────────────────────────────────
  function renderMinter(_nfd: Nfd, root: string, isOwner: boolean): HTMLElement {
    let label = '';
    let quote: NfdMintCostBreakdown | null = null;
    let qDebounce: ReturnType<typeof setTimeout> | null = null;
    let assignMode: 'self' | 'other' = 'self';

    const preview = el('span', { cls: 'parsec-nfdominter__suffix', text: `.${root}` });
    const segFeedback = el('div', { cls: 'parsec-nfdominter__feedback' });
    const segQuoteBox = el('div', { cls: 'parsec-nfdominter__quote-box', attrs: { hidden: 'true' } });

    const claimBtn = btn('Claim subdomain', {
      intent: 'primary', large: true, icon: 'confirm', disabled: true,
      cls: 'parsec-nfdominter__sign-btn',
      onClick: () => {
        if (!quote) return;
        const reservedFor = assignMode === 'other' ? recipientInput.value.trim() : undefined;
        setNfdPendingMint({ name: `${label}.${root}`, buyer, years: 1, cost: quote, network, reservedFor });
        store.navigate('nfdominter-confirm');
      },
    });

    function updateClaim(): void {
      const recipientOk = assignMode === 'self' || algosdk.isValidAddress(recipientInput.value.trim());
      claimBtn.disabled = !quote || !recipientOk;
    }

    const labelInput = input({
      placeholder: 'sea',
      cls: 'parsec-nfdominter__name-input bp5-input',
      onInput: (raw) => {
        label = raw.trim().toLowerCase();
        quote = null;
        segQuoteBox.setAttribute('hidden', 'true');
        segQuoteBox.innerHTML = '';
        updateClaim();
        if (qDebounce) clearTimeout(qDebounce);
        qDebounce = setTimeout(() => { void refreshSeg(); }, DEBOUNCE_MS);
      },
    });

    const modeSelect = el('select', {
      cls: 'bp5-input',
      children: [
        el('option', { attrs: { value: 'self' }, text: isOwner ? `Keep it — managed by ${root}` : 'Mint to my wallet' }),
        el('option', { attrs: { value: 'other' }, text: 'Assign to another wallet — independent' }),
      ],
    }) as HTMLSelectElement;
    const recipientInput = input({ placeholder: 'Recipient Algorand address', cls: 'bp5-input bp5-small' });
    recipientInput.addEventListener('input', updateClaim);
    const recipientField = el('label', {
      cls: 'parsec-nfdominter__edit-field',
      attrs: { hidden: 'true' },
      children: [
        el('span', { cls: 'parsec-nfdominter__edit-label', text: 'Recipient wallet' }),
        recipientInput,
        el('span', { cls: 'parsec-nfdominter__hint', text: 'This wallet owns the subdomain outright — independent, and you cannot edit it afterward.' }),
      ],
    });
    modeSelect.addEventListener('change', () => {
      assignMode = modeSelect.value === 'other' ? 'other' : 'self';
      recipientField.toggleAttribute('hidden', assignMode !== 'other');
      updateClaim();
    });

    async function refreshSeg(): Promise<void> {
      if (!label) { segFeedback.textContent = ''; return; }
      if (!LABEL_RE.test(label)) { segFeedback.textContent = 'Letters and digits only, 1–27 characters.'; return; }
      const full = `${label}.${root}`;
      segFeedback.textContent = `Checking ${full}…`;
      try {
        const existing = await lookupNfd(network, full);
        if (existing) { segFeedback.textContent = `${full} is already taken.`; return; }
        quote = await getMintQuoteWithBankonFee({ network, name: full, buyer, years: 1 });
        segFeedback.textContent = `${full} is available.`;
        const nfdPrice = quote.basePrice + quote.carryCost + quote.extraFee;
        segQuoteBox.innerHTML = '';
        segQuoteBox.append(
          quoteRow('NFD registry price', nfdPrice),
          quoteRow('NFDminter fee', quote.bankonFee),
          el('div', { cls: 'parsec-nfdominter__quote-total', children: [
            el('span', { text: 'Total' }),
            el('span', { text: algoStr(quote.totalMicroAlgos) }),
          ]}),
        );
        segQuoteBox.removeAttribute('hidden');
        updateClaim();
      } catch (e) {
        segFeedback.textContent = (e as Error).message;
      }
    }

    return el('div', {
      cls: 'parsec-nfdominter__sub-panel',
      children: [
        el('span', { cls: 'parsec-nfdominter__control-label', text: `Mint a subdomain under ${root}` }),
        el('div', { cls: 'parsec-nfdominter__name-row', children: [labelInput, preview] }),
        segFeedback,
        segQuoteBox,
        el('label', { cls: 'parsec-nfdominter__edit-field', children: [
          el('span', { cls: 'parsec-nfdominter__edit-label', text: 'Subdomain ownership' }),
          modeSelect,
        ]}),
        recipientField,
        claimBtn,
      ],
    });
  }

  // ── Owned-names picker — recognizes the account's roots up front ────────
  const ownedSection = el('div', {
    cls: 'parsec-nfdominter__owned-picker',
    children: [el('div', { cls: 'parsec-nfdominter__feedback', text: 'Finding your .algo names…' })],
  });
  void (async () => {
    try {
      const resp = await searchByOwner(network, buyer, { limit: 100, view: 'full' });
      const roots = resp.nfds.filter((n) => !isSegmentName(n.name));
      ownedSection.innerHTML = '';
      if (roots.length === 0) {
        ownedSection.append(
          el('p', { cls: 'parsec-empty', text: 'You don’t own any .algo names yet — claim one to mint subdomains under it.' }),
          btn('Claim a .algo name', { intent: 'primary', icon: 'plus', onClick: () => switchTab('mint') }),
        );
        return;
      }
      const select = el('select', {
        cls: 'bp5-input',
        children: roots.map((n) => el('option', { attrs: { value: n.name }, text: n.name })),
      }) as HTMLSelectElement;
      select.addEventListener('change', () => {
        const n = roots.find((r) => r.name === select.value);
        if (n) selectParent(n, true);
      });
      ownedSection.append(
        el('label', { cls: 'parsec-nfdominter__edit-field', children: [
          el('span', { cls: 'parsec-nfdominter__edit-label', text: 'Your .algo names' }),
          select,
        ]}),
      );
      selectParent(roots[0], true); // recognize and open the first one immediately
    } catch (e) {
      ownedSection.innerHTML = '';
      ownedSection.append(el('p', { cls: 'parsec-nfdominter__hint', text: `Could not load your names: ${(e as Error).message}` }));
    }
  })();

  // ── Secondary: mint under someone else's open name ──────────────────────
  let manualName = '';
  let manualDebounce: ReturnType<typeof setTimeout> | null = null;
  const manualInput = input({
    placeholder: 'someopenname',
    cls: 'bp5-input',
    onInput: (raw) => {
      manualName = raw.trim().toLowerCase().replace(/\.algo$/, '');
      if (manualDebounce) clearTimeout(manualDebounce);
      manualDebounce = setTimeout(() => {
        if (manualName) void refetchAndSelect(`${manualName}.algo`, false);
      }, DEBOUNCE_MS);
    },
  });
  const manualSection = el('details', {
    cls: 'parsec-nfdominter__manual',
    children: [
      el('summary', { text: 'Mint under another name' }),
      el('p', { cls: 'parsec-nfdominter__hint', text: 'Enter any .algo name that has opened subdomains to the public.' }),
      el('div', { cls: 'parsec-nfdominter__name-row', children: [
        manualInput,
        el('span', { cls: 'parsec-nfdominter__suffix', text: '.algo' }),
      ]}),
    ],
  });

  return el('div', {
    cls: 'parsec-nfdominter__subdomains',
    children: [
      el('p', { cls: 'parsec-view__desc', text: 'Mint subdomains — like sea.mindx.algo — under a .algo name you own.' }),
      ownedSection,
      action,
      manualSection,
    ],
  });
}

function quoteRow(label: string, micro: bigint): HTMLElement {
  return el('div', { cls: 'parsec-nfdominter__quote-row', children: [
    el('span', { text: label }),
    el('span', { text: algoStr(micro) }),
  ]});
}

function stateChip(text: string, kind: 'ok' | 'warn'): HTMLElement {
  return el('span', {
    cls: `parsec-nfdominter__chip parsec-nfdominter__chip--state-${kind === 'ok' ? 'available' : 'owned'}`,
    text,
  });
}
