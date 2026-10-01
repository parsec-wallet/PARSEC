// Permaweb — join the ar.io gateway network. Form → validate → preflight (all green) → confirm →
// joinNetwork signed by the vault-held operator key → verify the gateway PDA exists.

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import { validateJoinForm, joinNetwork, type JoinForm, type JoinPlan } from '../lib/permaweb/gateway/join';
import { runJoinPreflight, preflightPassed, type PreflightItem } from '../lib/permaweb/gateway/preflight';
import { getGatewayFor } from '../lib/permaweb/gateway/read';
import { observerAddressOf } from '../lib/permaweb/wallet/observer';
import { MIN_OPERATOR_STAKE_ARIO, GATEWAYS_DASHBOARD, SOLANA_EXPLORER_TX } from '../lib/permaweb/constants';
import { marioToArio } from '../lib/permaweb/units';

const DRAFT_KEY = 'parsec-permaweb-join-draft';

export function permawebGatewayJoinView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-confirm parsec-permaweb' });
  const st = store.get();
  const account = st.accounts[st.activeAccountIndex];
  const operator = account ? getAccountAddress(account, 'solana') : undefined;
  if (!account || !operator) { toast('Create or import the Solana operator wallet first', 'warning'); store.navigate('permaweb-desk'); return root; }

  let form: JoinForm = {
    fqdn: '', label: '', note: '', properties: '', operatorStakeArio: MIN_OPERATOR_STAKE_ARIO.toString(),
    observerAddress: observerAddressOf(account) ?? '', allowDelegatedStaking: true, minDelegatedStakeArio: '100',
    delegateRewardShareRatio: 10, autoStake: true, port: 443,
  };
  try { form = { ...form, ...(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}') as Partial<JoinForm>) }; } catch { /* ignore */ }

  let plan: JoinPlan | undefined;
  let errors: string[] = [];
  let preflight: PreflightItem[] | null = null;
  let busy = false;
  let result: { id: string } | null = null;
  let understood = false;

  const persist = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch { /* ignore */ } };

  function field(label: string, key: keyof JoinForm, opts: { type?: string; placeholder?: string } = {}): HTMLElement {
    const inp = input({ type: opts.type ?? 'text', placeholder: opts.placeholder, cls: 'bp5-input parsec-permaweb__wide', value: String(form[key] ?? ''), onInput: (v) => { (form as unknown as Record<string, unknown>)[key] = opts.type === 'number' ? Number(v) : v; persist(); } });
    return el('div', { cls: 'parsec-permaweb__field', children: [el('label', { text: label }), inp] });
  }
  function check(label: string, key: 'allowDelegatedStaking' | 'autoStake'): HTMLElement {
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = form[key];
    cb.addEventListener('change', () => { form[key] = cb.checked; persist(); });
    return el('label', { cls: 'bp5-control bp5-checkbox', children: [cb, el('span', { cls: 'bp5-control-indicator' }), label] });
  }

  async function validateAndPreflight(): Promise<void> {
    const v = validateJoinForm(form);
    errors = v.errors; plan = v.plan; preflight = null; understood = false;
    render();
    if (!plan) return;
    busy = true; render();
    try { preflight = await runJoinPreflight(operator!, plan); } catch (e) { errors = [e instanceof Error ? e.message : String(e)]; }
    busy = false; render();
  }

  async function sign(): Promise<void> {
    if (!plan || !preflight || !preflightPassed(preflight) || !understood || busy) return;
    const passphrase = store.getPassphrase();
    if (!passphrase) { toast('Wallet is locked', 'danger'); store.navigate('unlock'); return; }
    const typed = window.prompt(`Type JOIN to stake ${marioToArio(BigInt(plan.operatorStake))} ARIO from ${operator} and register ${plan.fqdn}. Leaving later vaults the stake for the withdrawal period.`);
    if (typed !== 'JOIN') return;
    busy = true; render();
    try {
      result = await joinNetwork({ address: operator!, passphrase }, plan);
      const gw = await getGatewayFor(operator!);
      toast(gw ? `Gateway registered: ${gw.status}, stake ${marioToArio(BigInt(gw.operatorStake))} ARIO` : 'Transaction sent — gateway not visible yet, refresh the desk', 'success', 12000);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger'); }
    busy = false; render();
  }

  function render(): void {
    root.innerHTML = '';
    root.appendChild(el('div', { cls: 'parsec-view__header', children: [
      btn('Back', { minimal: true, icon: 'arrow-left', onClick: () => store.navigate('permaweb-desk') }),
      el('h2', { cls: 'parsec-view__title', text: 'Join the ar.io network' }),
    ] }));
    root.appendChild(el('p', { cls: 'parsec-view__desc', text: `Operator (signs here, stays in the vault): ${operator}. Minimum stake ${MIN_OPERATOR_STAKE_ARIO} ARIO + a little SOL. The gateway node must already answer at https://<fqdn>/ar-io/info with this operator as its wallet.` }));

    if (result) {
      root.appendChild(el('div', { cls: 'parsec-callout bp5-callout bp5-intent-success', children: [
        el('p', { text: 'joinNetwork submitted.' }),
        el('a', { attrs: { href: SOLANA_EXPLORER_TX + result.id, target: '_blank', rel: 'noopener' }, text: result.id }),
        el('br'),
        el('a', { attrs: { href: GATEWAYS_DASHBOARD + operator, target: '_blank', rel: 'noopener' }, text: 'Open on gateways.ar.io →' }),
      ] }));
      root.appendChild(btn('Back to desk', { intent: 'primary', large: true, onClick: () => store.navigate('permaweb-desk') }));
      return;
    }

    const f = el('div', { cls: 'parsec-confirm__details parsec-permaweb__form' });
    f.appendChild(el('h4', { text: 'Gateway' }));
    f.appendChild(field('FQDN (bare hostname)', 'fqdn', { placeholder: 'gw.example.com' }));
    f.appendChild(el('div', { cls: 'parsec-permaweb__grid-2', children: [field('Label', 'label', { placeholder: 'My gateway' }), field('Port', 'port', { type: 'number' })] }));
    f.appendChild(field('Note (public)', 'note'));
    f.appendChild(field('Properties (Arweave tx id, optional)', 'properties'));
    f.appendChild(el('h4', { text: 'Stake & delegation' }));
    f.appendChild(el('div', { cls: 'parsec-permaweb__grid-2', children: [
      field(`Operator stake (ARIO, ≥ ${MIN_OPERATOR_STAKE_ARIO})`, 'operatorStakeArio'),
      field('Delegate reward share (%)', 'delegateRewardShareRatio', { type: 'number' }),
      field('Min delegated stake (ARIO)', 'minDelegatedStakeArio'),
      field('Observer address (separate key recommended)', 'observerAddress'),
    ] }));
    f.appendChild(el('div', { cls: 'parsec-permaweb__segmented', children: [check('Allow delegated staking', 'allowDelegatedStaking'), check('Auto-stake rewards', 'autoStake')] }));
    f.appendChild(btn(busy && !preflight ? 'Checking…' : 'Validate & run preflight', { intent: 'primary', icon: 'diagnosis', disabled: busy, onClick: () => void validateAndPreflight() }));
    root.appendChild(f);

    if (errors.length) root.appendChild(el('div', { cls: 'parsec-callout bp5-callout bp5-intent-danger', children: errors.map((e) => el('p', { text: e })) }));

    if (preflight) {
      const list = el('ul', { cls: 'parsec-permaweb__preflight' });
      for (const it of preflight) {
        const kind = it.ok ? (it.warn ? 'warn' : 'ok') : 'fail';
        list.appendChild(el('li', { cls: `parsec-permaweb__preflight-item parsec-permaweb__preflight-item--${kind}`, children: [
          el('span', { cls: 'parsec-permaweb__mark', text: it.ok ? (it.warn ? '!' : '✓') : '✗' }),
          el('span', { children: [it.label, el('small', { text: it.detail })] }),
        ] }));
      }
      const ok = preflightPassed(preflight);
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = understood; cb.addEventListener('change', () => { understood = cb.checked; render(); });
      root.appendChild(el('div', { cls: 'parsec-confirm__details', children: [
        el('h4', { text: ok ? 'Preflight passed' : 'Preflight failed — fix the ✗ items and re-run' }),
        list,
        ...(ok ? [
          el('label', { cls: 'bp5-control bp5-checkbox', children: [cb, el('span', { cls: 'bp5-control-indicator' }), 'I understand: the stake is locked while joined; leaving vaults it for the withdrawal period; 30 consecutive failed epochs prune the gateway and slash the minimum stake.'] }),
          el('div', { cls: 'parsec-confirm__actions', children: [
            btn('Re-run preflight', { outlined: true, onClick: () => void validateAndPreflight() }),
            btn(busy ? 'Signing…' : `Sign & join (${plan ? marioToArio(BigInt(plan.operatorStake)) : ''} ARIO)`, { intent: 'danger', large: true, icon: 'key', disabled: !understood || busy, onClick: () => void sign() }),
          ] }),
        ] : [btn('Re-run preflight', { outlined: true, onClick: () => void validateAndPreflight() })]),
      ] }));
    }
  }

  render();
  return root;
}
