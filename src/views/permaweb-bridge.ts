// Permaweb — Base → Solana ARIO bridge, in-wallet.
//
// The bridge is one EVM call: the Base ARIO token's `burn(amount, "solana:<dest>")`; ar.io's bridge
// service watches the Burn event (3 confirmations) and sends SPL ARIO to <dest>, paying the ATA rent.
// Two signing sources, both self-custody: an injected browser wallet (MetaMask etc.) or a vault-held
// EVM key signed in Rust. The Solana destination is always a parsec-held address.

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { marioToArio, arioToMario } from '../lib/permaweb/units';
import { BASE_ARIO, SWAP_URL, SOL_AR_IO_URL, BASESCAN_TX, SOLANA_EXPLORER_TX, BRIDGE_CONFIRMATIONS } from '../lib/permaweb/constants';
import { readBaseArioBalance, readEthBalance, waitForReceipt } from '../lib/permaweb/bridge/base-rpc';
import { getBridgeInfo, pollTransfer, type BridgeInfo, type BridgeTransfer } from '../lib/permaweb/bridge/service';
import { planBridge, DEFAULT_TEST_TRANCHE_RAW } from '../lib/permaweb/bridge/plan';
import { injectedRequest, connectInjectedOnBase, burnViaInjected, type ProviderRequest } from '../lib/permaweb/bridge/injected';
import { burnViaVault } from '../lib/permaweb/bridge/vault-evm';
import { importEvmKeyToVault, previewEvmKey, readEvmAddress, vaultEvmAvailable } from '../lib/permaweb/evm/vault-key';
import { getTokenBalance } from '../lib/solana/token';

type Source = 'injected' | 'vault';

interface BridgeRecord { hash: string; amountRaw: string; at: number; status: string; outputTxId?: string }

const HISTORY_KEY = 'parsec-permaweb-bridge-history';
function loadHistory(): BridgeRecord[] { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as BridgeRecord[]; } catch { return []; } }
function saveHistory(h: BridgeRecord[]): void { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-50))); } catch { /* ignore */ } }

export function permawebBridgeView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-confirm parsec-permaweb' });
  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  if (!account) { store.navigate('onboarding'); return root; }

  const state = {
    source: (vaultEvmAvailable() && readEvmAddress(account) ? 'vault' : 'injected') as Source,
    request: null as ProviderRequest | null,
    evmAddress: readEvmAddress(account) as string | undefined,
    baseBalanceRaw: undefined as bigint | undefined,
    ethWei: undefined as bigint | undefined,
    solanaAddress: getAccountAddress(account, 'solana'),
    solanaArio: undefined as string | undefined,
    info: undefined as BridgeInfo | undefined,
    amountArio: '',
    testTranche: true,
    running: false,
    log: [] as string[],
    error: undefined as string | undefined,
    history: loadHistory(),
    keyDraft: '',
    keyPreview: '',
  };

  const log = (m: string) => { state.log.push(`${new Date().toLocaleTimeString()}  ${m}`); render(); };

  void getBridgeInfo().then((i) => { state.info = i; render(); }).catch((e) => { state.error = `bridge service: ${e instanceof Error ? e.message : String(e)}`; render(); });
  if (state.solanaAddress) void refreshSolana();
  if (state.evmAddress) void refreshBase();

  async function refreshBase(): Promise<void> {
    if (!state.evmAddress) return;
    try {
      [state.baseBalanceRaw, state.ethWei] = await Promise.all([readBaseArioBalance(state.evmAddress), readEthBalance(state.evmAddress)]);
      if (!state.amountArio && state.baseBalanceRaw > 0n) state.amountArio = marioToArio(state.baseBalanceRaw);
    } catch (e) { state.error = `Base read failed: ${e instanceof Error ? e.message : String(e)}`; }
    render();
  }
  async function refreshSolana(): Promise<void> {
    if (!state.solanaAddress) return;
    try { state.solanaArio = (await getTokenBalance(state.solanaAddress)).uiAmountString; } catch (e) { state.error = `Solana read failed: ${e instanceof Error ? e.message : String(e)}`; }
    render();
  }

  async function connectInjected(): Promise<void> {
    const req = injectedRequest();
    if (!req) { state.error = 'No injected EVM wallet detected (MetaMask / Coinbase / Rabby).'; render(); return; }
    try {
      state.evmAddress = await connectInjectedOnBase(req);
      state.request = req;
      state.error = undefined;
      await refreshBase();
    } catch (e) { state.error = e instanceof Error ? e.message : String(e); render(); }
  }

  async function importKey(): Promise<void> {
    const passphrase = store.getPassphrase();
    if (!passphrase) { toast('Wallet is locked', 'danger'); store.navigate('unlock'); return; }
    try {
      const st = store.get();
      const acc = st.accounts[st.activeAccountIndex];
      const { account: updated, address } = await importEvmKeyToVault(state.keyDraft, passphrase, acc);
      const accounts = [...st.accounts]; accounts[st.activeAccountIndex] = updated; store.set({ accounts });
      state.evmAddress = address; state.keyDraft = ''; state.keyPreview = '';
      toast(`EVM key ${address.slice(0, 10)}… stored in vault`, 'success');
      await refreshBase();
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger'); }
  }

  async function execute(): Promise<void> {
    if (state.running) return;
    const dest = state.solanaAddress;
    if (!dest) { toast('Create or import a Solana destination first', 'warning'); return; }
    if (!state.evmAddress || state.baseBalanceRaw === undefined) { toast('Connect the Base source first', 'warning'); return; }
    if (state.source === 'injected' && !state.request) { toast('Connect the injected wallet first', 'warning'); return; }
    let amountRaw: bigint;
    try { amountRaw = arioToMario(state.amountArio); } catch { toast('Enter a valid ARIO amount', 'warning'); return; }
    const plan = planBridge({
      balanceRaw: state.baseBalanceRaw, amountRaw, minAmountRaw: BigInt(state.info?.minAmountRaw ?? '1000000'),
      testTrancheRaw: state.testTranche ? DEFAULT_TEST_TRANCHE_RAW : 0n, bridgeClosing: true,
    });
    if (plan.errors.length) { toast(plan.errors.join(' · '), 'danger'); return; }
    const confirmMsg = `Burn ${marioToArio(amountRaw)} ARIO on Base in ${plan.tranches.length} transaction(s) → ${dest}?\n\nThis is irreversible on Base. The bridge service credits Solana after ${BRIDGE_CONFIRMATIONS} confirmations.`;
    if (!window.confirm(confirmMsg)) return;

    state.running = true; state.error = undefined; state.log = [];
    try {
      for (let i = 0; i < plan.tranches.length; i++) {
        const tranche = plan.tranches[i];
        log(`tranche ${i + 1}/${plan.tranches.length}: burn ${marioToArio(tranche)} ARIO`);
        const hash = state.source === 'injected'
          ? await burnViaInjected(state.request!, { from: state.evmAddress, amountRaw: tranche, solanaDestination: dest })
          : (await burnViaVault({ evmAddress: state.evmAddress, amountRaw: tranche, solanaDestination: dest })).hash;
        const rec: BridgeRecord = { hash, amountRaw: tranche.toString(), at: Date.now(), status: 'submitted' };
        state.history.push(rec); saveHistory(state.history);
        log(`submitted ${hash}`);
        await waitForReceipt(hash, BRIDGE_CONFIRMATIONS, { onProgress: (c) => { rec.status = `${c}/${BRIDGE_CONFIRMATIONS} confirmations`; render(); } });
        rec.status = 'confirmed on Base — waiting for bridge service'; saveHistory(state.history); log('confirmed on Base');
        const t: BridgeTransfer = await pollTransfer(hash, (u) => { rec.status = u.status ?? rec.status; if (u.outputTxId) rec.outputTxId = u.outputTxId; render(); });
        rec.status = t.outputTxId ? 'delivered' : (t.error ?? t.status ?? 'unknown');
        if (t.outputTxId) rec.outputTxId = t.outputTxId;
        saveHistory(state.history);
        log(t.outputTxId ? `delivered on Solana: ${t.outputTxId}` : `bridge status: ${rec.status}`);
        await refreshSolana();
        if (!t.outputTxId && t.error) throw new Error(t.error);
        if (i === 0 && plan.tranches.length > 1 && !window.confirm(`Test tranche delivered (Solana ARIO now ${state.solanaArio}). Send the remaining ${marioToArio(plan.tranches[1])} ARIO?`)) break;
      }
      await refreshBase();
      toast('Bridge run finished', 'success');
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      toast(state.error, 'danger');
    } finally { state.running = false; render(); }
  }

  function row(label: string, value: string): HTMLElement {
    return el('div', { cls: 'parsec-confirm__row', children: [el('span', { cls: 'parsec-confirm__label', text: label }), el('span', { cls: 'parsec-confirm__value', text: value })] });
  }

  function sourceSection(): HTMLElement {
    const sec = el('div', { cls: 'parsec-confirm__details' });
    sec.appendChild(el('h4', { text: 'Source: ARIO on Base' }));
    const picker = el('div', { cls: 'parsec-permaweb__segmented' });
    for (const [id, label] of [['injected', 'Browser wallet (MetaMask…)'], ['vault', 'Vault EVM key (signed in parsec)']] as [Source, string][]) {
      picker.appendChild(btn(label, { outlined: state.source !== id, intent: state.source === id ? 'primary' : 'none', disabled: id === 'vault' && !vaultEvmAvailable(), onClick: () => { state.source = id; render(); } }));
    }
    sec.appendChild(picker);
    if (state.source === 'injected') {
      if (!state.request) sec.appendChild(btn('Connect wallet on Base', { intent: 'primary', icon: 'link', onClick: () => void connectInjected() }));
    } else {
      const vaultAddr = readEvmAddress(store.get().accounts[store.get().activeAccountIndex]);
      if (!vaultAddr) {
        sec.appendChild(el('p', { cls: 'parsec-view__desc', text: 'Import the Base account\'s private key into the vault (it stays encrypted; Rust signs the burn). Paste a 0x… 32-byte hex key.' }));
        const keyInput = input({ type: 'password', placeholder: '0x… private key', cls: 'bp5-input parsec-permaweb__wide', value: state.keyDraft, onInput: (v) => { state.keyDraft = v; void previewEvmKey(v).then((a) => { state.keyPreview = a; render(); }).catch(() => { state.keyPreview = ''; }); } });
        sec.appendChild(keyInput);
        if (state.keyPreview) sec.appendChild(row('Address', state.keyPreview));
        sec.appendChild(btn('Store key in vault', { intent: 'primary', icon: 'lock', disabled: !state.keyPreview, onClick: () => void importKey() }));
      } else {
        state.evmAddress = vaultAddr;
      }
    }
    if (state.evmAddress) {
      sec.appendChild(row('Address', state.evmAddress));
      sec.appendChild(row('Base ARIO', state.baseBalanceRaw === undefined ? 'reading…' : `${marioToArio(state.baseBalanceRaw)} ARIO`));
      sec.appendChild(row('Base ETH (gas)', state.ethWei === undefined ? '—' : `${(Number(state.ethWei) / 1e18).toFixed(6)} ETH`));
      sec.appendChild(btn('Refresh', { minimal: true, icon: 'refresh', onClick: () => void refreshBase() }));
    }
    return sec;
  }

  function destinationSection(): HTMLElement {
    const sec = el('div', { cls: 'parsec-confirm__details' });
    sec.appendChild(el('h4', { text: 'Destination: Solana (parsec-held)' }));
    if (!state.solanaAddress) {
      sec.appendChild(el('p', { text: 'No Solana address on this account yet.' }));
      sec.appendChild(el('div', { cls: 'parsec-permaweb__segmented', children: [
        btn('Create Solana wallet', { intent: 'primary', icon: 'plus', onClick: () => store.navigate('solana-create') }),
        btn('Import existing key', { outlined: true, icon: 'import', onClick: () => store.navigate('solana-import') }),
      ] }));
      return sec;
    }
    sec.appendChild(row('Address', state.solanaAddress));
    sec.appendChild(row('Solana ARIO', state.solanaArio === undefined ? '—' : `${state.solanaArio} ARIO`));
    sec.appendChild(btn('Verify arrival', { minimal: true, icon: 'refresh', onClick: () => void refreshSolana() }));
    return sec;
  }

  function amountSection(): HTMLElement {
    const sec = el('div', { cls: 'parsec-confirm__details' });
    sec.appendChild(el('h4', { text: 'Amount' }));
    const amt = input({ type: 'text', placeholder: 'ARIO', cls: 'bp5-input', value: state.amountArio, onInput: (v) => { state.amountArio = v; } });
    sec.appendChild(el('div', { cls: 'parsec-permaweb__segmented', children: [
      amt,
      btn('Max', { minimal: true, onClick: () => { if (state.baseBalanceRaw !== undefined) { state.amountArio = marioToArio(state.baseBalanceRaw); render(); } } }),
    ] }));
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = state.testTranche; cb.addEventListener('change', () => { state.testTranche = cb.checked; });
    sec.appendChild(el('label', { cls: 'bp5-control bp5-checkbox', children: [cb, el('span', { cls: 'bp5-control-indicator' }), `Send a ${marioToArio(DEFAULT_TEST_TRANCHE_RAW)} ARIO test tranche first, then the remainder`] }));
    if (state.info) {
      sec.appendChild(row('Bridge', `${state.info.direction} · fee ${state.info.feePercentage}% · min ${marioToArio(BigInt(state.info.minAmountRaw))} ARIO · ${state.info.base.confirmations} confirmations${state.info.bridgePaysRecipientAccountRent ? ' · bridge pays ATA rent' : ''}`));
    }
    sec.appendChild(row('Contract', `${BASE_ARIO} · burn(uint256,string)`));
    return sec;
  }

  function runSection(): HTMLElement {
    const sec = el('div', { cls: 'parsec-confirm__details' });
    sec.appendChild(el('div', { cls: 'parsec-confirm__actions', children: [
      btn('Back', { outlined: true, large: true, onClick: () => store.navigate('dashboard') }),
      btn(state.running ? 'Bridging…' : 'Burn on Base → receive on Solana', { intent: 'danger', large: true, icon: 'exchange', disabled: state.running, onClick: () => void execute() }),
    ] }));
    if (state.log.length) sec.appendChild(el('pre', { cls: 'parsec-permaweb__log', text: state.log.join('\n') }));
    if (state.history.length) {
      sec.appendChild(el('h4', { text: 'Bridge history (this device)' }));
      for (const h of [...state.history].reverse().slice(0, 10)) {
        sec.appendChild(el('div', { cls: 'parsec-confirm__row', children: [
          el('a', { attrs: { href: BASESCAN_TX + h.hash, target: '_blank', rel: 'noopener' }, text: `${h.hash.slice(0, 12)}…` }),
          el('span', { text: `${marioToArio(BigInt(h.amountRaw))} ARIO · ${h.status}` }),
          ...(h.outputTxId ? [el('a', { attrs: { href: SOLANA_EXPLORER_TX + h.outputTxId, target: '_blank', rel: 'noopener' }, text: 'solana tx' })] : []),
        ] }));
      }
    }
    sec.appendChild(el('p', { cls: 'parsec-view__desc', children: [
      'Fallback: the official UI does the same burn — ',
      el('a', { attrs: { href: SWAP_URL, target: '_blank', rel: 'noopener' }, text: 'swap.ar.io' }),
      ' · missed the snapshot? ',
      el('a', { attrs: { href: SOL_AR_IO_URL, target: '_blank', rel: 'noopener' }, text: 'sol.ar.io' }),
    ] }));
    return sec;
  }

  function render(): void {
    root.innerHTML = '';
    root.appendChild(el('div', { cls: 'parsec-view__header', children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('dashboard') }),
      el('h2', { cls: 'parsec-view__title', text: 'Bridge ARIO: Base → Solana' }),
    ] }));
    root.appendChild(el('div', { cls: 'parsec-callout bp5-callout bp5-intent-danger', children: [el('p', { text: 'ar.io says this bridge is closing (no date published). ARIO on Solana is canonical. Migrate held Base ARIO now — test tranche first. Burns are irreversible on Base.' })] }));
    root.appendChild(sourceSection());
    root.appendChild(destinationSection());
    root.appendChild(amountSection());
    root.appendChild(runSection());
    if (state.error) root.appendChild(el('div', { cls: 'parsec-callout bp5-callout bp5-intent-warning', children: [el('p', { text: state.error })] }));
  }

  render();
  return root;
}
