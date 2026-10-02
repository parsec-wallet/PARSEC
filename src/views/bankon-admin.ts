// BANKON Names — maintainer admin view.
//
// Two modes:
//   * spawn: when the BNR is unconfigured OR sessionStorage requests it,
//            walk the maintainer through signing + posting the Spawn
//            DataItem using the active Arweave key.
//   * governance: when the BNR is configured AND the active address is in
//                 BNR.Info.controllers, expose Set-Policy / Set-Treasury /
//                 Add-Controller / Remove-Controller / Set-Reserved.
//
// The spawn mode reads BNR_LUA_SOURCE (bundled at build time from
// bankon-names-process/) so we never touch the filesystem at runtime.

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import {
  isBnrConfigured,
  setBnrProcessId,
  getBnrProcessId,
} from '../lib/bankon-names/process-id';
import { BNR_LUA_SOURCE, BNR_LUA_SIZE, bnrLuaDigest } from '../lib/bankon-names/lua-source';
import { BMR_LUA_SOURCE, BMR_LUA_SIZE, bmrLuaDigest } from '../lib/marketplace/lua-source';
import { getBmrProcessId, isBmrConfigured, setBmrProcessId } from '../lib/marketplace/process-id';
import {
  getBnrInfo,
  buildSetPolicyInput,
  buildSetTreasuryInput,
  buildAddControllerInput,
  buildRemoveControllerInput,
  buildSetReservedInput,
  type BnrInfo,
} from '../lib/bankon-names/client';
import type { PaymentMethod } from '../lib/bankon-names/payment';
import { signDataItemFromVault, signDataItemWith } from '../lib/arweave/ans104';
import {
  aoMessage,
  aoResult,
  aoSpawn,
  buildAoSpawnInput,
  setAoEndpoints,
  AOS_MODULE,
} from '../lib/arweave/ao';
import {
  AO_AUTHORITY,
  DEFAULT_SCHEDULER,
} from '../lib/arweave/ario';
import { vaultArweaveKey, type ArweaveVaultKey } from '../lib/arweave/vault-key';

const SPAWN_TIMEOUT_MS = 90_000;
const AO_MAINNET_MU = 'https://mu.ao-testnet.xyz';
const AR_IO_CU = 'https://cu.ardrive.io';

type Mode = 'spawn' | 'governance';

export function bankonAdminView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-confirm' });

  // Resolve current mode. Spawn mode is forced when the BNR is unconfigured;
  // sessionStorage hint takes precedence otherwise.
  const requested = sessionStorage.getItem('parsec:bankon-admin-mode');
  const mode: Mode = (!isBnrConfigured() || requested === 'spawn') ? 'spawn' : 'governance';

  root.appendChild(el('div', {
    cls: 'parsec-view__header',
    children: [
      btn('Back', {
        minimal: true,
        icon: 'arrow-left',
        onClick: () => {
          sessionStorage.removeItem('parsec:bankon-admin-mode');
          store.navigate('bankon-hub');
        },
      }),
      el('h2', {
        cls: 'parsec-view__title',
        text: mode === 'spawn' ? 'Spawn BANKON Names Registry' : 'BANKON Names — Admin',
      }),
    ],
  }));

  const s = store.get();
  const account = s.accounts[s.activeAccountIndex];
  const address = account
    ? (getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave'))
    : undefined;

  if (!address) {
    root.appendChild(noArweaveAddressBanner());
    return root;
  }

  if (mode === 'spawn') {
    root.appendChild(buildSpawnPanel(address, root));
  } else {
    root.appendChild(buildGovernancePanel(address, root));
  }

  return root;
}

function noArweaveAddressBanner(): HTMLElement {
  return el('div', {
    cls: 'parsec-callout bp5-callout bp5-intent-warning',
    children: [
      el('p', { text: 'No Arweave address on the active account. Create one before spawning the BNR.' }),
      btn('Create Arweave', {
        intent: 'primary',
        onClick: () => store.navigate('arweave-create'),
      }),
    ],
  });
}

// ── Spawn mode ────────────────────────────────────────────────

function buildSpawnPanel(address: string, root: HTMLElement): HTMLElement {
  const container = el('div', {});

  let treasuryAr = address;       // default: same key custodies the AR treasury
  let initialController = address;
  let busy = false;
  let digest = '...';

  void bnrLuaDigest().then((h) => {
    digest = h;
    digestEl.textContent = `${digest.slice(0, 16)}... (sha256)`;
  });

  const treasuryInput = input({
    placeholder: 'Arweave treasury address (default: active address)',
    cls: 'bp5-input bp5-fill',
    value: treasuryAr,
    onInput: (v) => { treasuryAr = v.trim() || address; },
  });
  const controllerInput = input({
    placeholder: 'Initial controller address (default: active address)',
    cls: 'bp5-input bp5-fill',
    value: initialController,
    onInput: (v) => { initialController = v.trim() || address; },
  });

  const digestEl = el('span', { cls: 'parsec-confirm__value', text: 'computing...' });
  const sizeEl = el('span', { cls: 'parsec-confirm__value', text: `${BNR_LUA_SIZE} bytes` });

  const statusBox = el('pre', {
    cls: 'parsec-confirm__details',
    attrs: { style: 'white-space: pre-wrap; min-height: 60px; max-height: 280px; overflow: auto;' },
    text: '',
  });
  const log = (m: string) => { statusBox.textContent = `${statusBox.textContent ?? ''}[${new Date().toLocaleTimeString()}] ${m}\n`; };

  container.appendChild(el('p', {
    cls: 'parsec-view__desc',
    text: 'The wallet will sign the AO Spawn DataItem using your Arweave key, post it to the AO MU, and poll the CU for confirmation. The resulting process id is persisted to localStorage; no source file is modified.',
  }));

  container.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [
      row('Signing as', truncAddr(address)),
      row('Lua bundle size', sizeEl),
      row('Lua bundle digest', digestEl),
      el('label', { text: 'Treasury (Arweave)' }),
      treasuryInput,
      el('label', { text: 'Initial controller' }),
      controllerInput,
    ],
  }));

  container.appendChild(statusBox);

  container.appendChild(el('div', {
    cls: 'parsec-confirm__actions',
    children: [
      btn('Cancel', {
        outlined: true,
        large: true,
        onClick: () => {
          sessionStorage.removeItem('parsec:bankon-admin-mode');
          store.navigate('bankon-hub');
        },
      }),
      btn('Sign & spawn', {
        intent: 'primary',
        large: true,
        icon: 'play',
        onClick: async () => {
          if (busy) return;
          busy = true;
          try {
            await runSpawn(address, treasuryAr, initialController, log, root);
          } catch (e) {
            log(`failed: ${e instanceof Error ? e.message : String(e)}`);
          } finally {
            busy = false;
          }
        },
      }),
    ],
  }));

  return container;
}

async function runSpawn(
  address: string,
  treasuryAr: string,
  initialController: string,
  log: (msg: string) => void,
  root: HTMLElement,
): Promise<void> {
  const passphrase = store.getPassphrase();
  if (!passphrase) {
    toast('Wallet is locked', 'danger');
    store.navigate('unlock');
    return;
  }

  // Sign the Spawn DataItem ourselves (signDataItemFromVault hardcodes a
  // Message-typed DataItem); the owner is the maintainer's modulus.
  log('Opening the vault key...');
  let key: ArweaveVaultKey;
  try {
    key = await vaultArweaveKey(address, passphrase);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return;
  }

  log(`Bundled Lua source: ${BNR_LUA_SIZE} bytes`);
  log('Building Spawn DataItem...');

  const spawnInput = buildAoSpawnInput({
    module: AOS_MODULE,
    scheduler: DEFAULT_SCHEDULER,
    onBoot: true,
    tags: [
      { name: 'Authority', value: AO_AUTHORITY },
      { name: 'Name', value: 'BANKON-Names' },
      { name: 'Initial-Controller', value: initialController },
      { name: 'Treasury-Arweave', value: treasuryAr },
    ],
    data: BNR_LUA_SOURCE,
  });

  log('Signing...');
  const signed = await signDataItemWith({ ...spawnInput, owner: key.owner }, key.sign).finally(() => key.dispose());
  log(`Signed (id=${signed.id}). Posting to AO MU...`);

  // Ensure the CU is set to the AR.IO CU so the result poll hits the right endpoint.
  setAoEndpoints({ mu: AO_MAINNET_MU, cu: AR_IO_CU });

  await aoSpawn(signed);
  log('Posted. Polling for confirmation...');

  const deadline = Date.now() + SPAWN_TIMEOUT_MS;
  let confirmed = false;
  while (Date.now() < deadline) {
    try {
      await aoResult({ message: signed.id, process: signed.id });
      confirmed = true;
      break;
    } catch {
      await sleep(2500);
    }
  }
  if (!confirmed) {
    log(`Spawn ${signed.id} not confirmed within ${SPAWN_TIMEOUT_MS / 1000}s.`);
    log('You can retry later — the spawn may still land. Use scripts/spawn-bnr.mjs --force to overwrite.');
    return;
  }

  setBnrProcessId(signed.id);
  log(`BNR live at process ${signed.id}.`);
  sessionStorage.removeItem('parsec:bankon-admin-mode');
  toast('BANKON Names Registry spawned', 'success');

  // Replace the spawn panel with a quick "go to hub" CTA.
  root.appendChild(el('div', {
    cls: 'parsec-confirm__actions',
    children: [
      btn('Back to BANKON hub', {
        intent: 'primary',
        large: true,
        onClick: () => store.navigate('bankon-hub'),
      }),
    ],
  }));
}

// ── Governance mode ───────────────────────────────────────────

function buildGovernancePanel(address: string, root: HTMLElement): HTMLElement {
  const container = el('div', {});
  const infoBox = el('div', { cls: 'parsec-confirm__details', children: [el('p', { text: 'Loading registry info...' })] });
  container.appendChild(infoBox);

  let info: BnrInfo | null = null;

  void (async () => {
    try {
      info = await getBnrInfo();
      if (!info) {
        infoBox.innerHTML = '';
        infoBox.appendChild(el('p', { cls: 'parsec-empty', text: 'Could not read BNR.Info — registry may be unreachable.' }));
        return;
      }
      renderInfo(infoBox, info);

      // Render governance forms only if the active address is a controller.
      const isController = info.controllers.includes(address);
      if (!isController) {
        container.appendChild(el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-warning',
          children: [
            el('p', { text: 'You are not a controller of this BNR. Governance actions are read-only.' }),
            el('p', { text: `Controllers: ${info.controllers.map(truncAddr).join(', ')}` }),
          ],
        }));
        return;
      }
      container.appendChild(buildGovernanceForms(address, info));
    } catch (e) {
      infoBox.innerHTML = '';
      infoBox.appendChild(el('p', { cls: 'parsec-empty', text: `Info read failed: ${e instanceof Error ? e.message : String(e)}` }));
    }
  })();

  // Also expose a "re-spawn" affordance for the controller (useful when the
  // bundled Lua source changes and they want to deploy a fresh process).
  container.appendChild(el('div', {
    cls: 'parsec-confirm__actions',
    children: [
      btn('Spawn a new BNR', {
        outlined: true,
        icon: 'refresh',
        onClick: () => {
          sessionStorage.setItem('parsec:bankon-admin-mode', 'spawn');
          // Force re-render by navigating away and back.
          store.navigate('bankon-hub');
          requestAnimationFrame(() => store.navigate('bankon-admin'));
        },
      }),
    ],
  }));

  // Marketspace registry spawn / status panel — same flow as the BNR but
  // for the BMR. Always visible to the maintainer regardless of whether
  // they're an active controller of either.
  container.appendChild(buildMarketspacePanel(address, root));

  void root;  // root unused in governance mode otherwise; keep signature uniform
  return container;
}

function buildMarketspacePanel(address: string, parentRoot: HTMLElement): HTMLElement {
  const panel = el('div', { cls: 'parsec-confirm__details' });
  panel.appendChild(el('h4', { text: 'Marketspace (BMR)' }));

  if (isBmrConfigured()) {
    panel.appendChild(row('BMR process id', truncAddr(getBmrProcessId())));
    panel.appendChild(el('p', { cls: 'parsec-view__desc', text: 'BMR is live. Visit the marketspace hub to manage listings.' }));
    panel.appendChild(btn('Open Marketspace', {
      intent: 'primary',
      onClick: () => store.navigate('market-hub'),
    }));
    return panel;
  }

  const digestEl = el('span', { cls: 'parsec-confirm__value', text: 'computing...' });
  void bmrLuaDigest().then((h) => { digestEl.textContent = `${h.slice(0, 16)}... (sha256)`; });

  let busy = false;
  const statusBox = el('pre', {
    cls: 'parsec-confirm__details',
    attrs: { style: 'white-space: pre-wrap; min-height: 60px; max-height: 240px; overflow: auto;' },
    text: '',
  });
  const log = (m: string) => { statusBox.textContent = `${statusBox.textContent ?? ''}[${new Date().toLocaleTimeString()}] ${m}\n`; };

  panel.appendChild(row('Bundle size', `${BMR_LUA_SIZE} bytes`));
  panel.appendChild(row('Bundle digest', digestEl));
  panel.appendChild(el('p', {
    cls: 'parsec-view__desc',
    text: 'The BMR signs outbound name transfers from escrow. Treasury defaults to the same Arweave address. The BNR process id is wired into the BMR boot so settle.lua can emit BNR Transfer messages on sold listings.',
  }));
  panel.appendChild(statusBox);
  panel.appendChild(btn('Spawn BMR', {
    intent: 'primary',
    large: true,
    icon: 'play',
    onClick: async () => {
      if (busy) return;
      busy = true;
      try {
        await runBmrSpawn(address, log, parentRoot);
      } catch (e) {
        log(`failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        busy = false;
      }
    },
  }));
  return panel;
}

async function runBmrSpawn(
  address: string,
  log: (msg: string) => void,
  root: HTMLElement,
): Promise<void> {
  const passphrase = store.getPassphrase();
  if (!passphrase) {
    toast('Wallet is locked', 'danger');
    store.navigate('unlock');
    return;
  }
  log('Opening the vault key...');
  let key: ArweaveVaultKey;
  try {
    key = await vaultArweaveKey(address, passphrase);
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return;
  }

  log(`Bundled BMR Lua: ${BMR_LUA_SIZE} bytes`);
  log('Building Spawn DataItem...');

  const bnrId = getBnrProcessId();
  const spawnInput = buildAoSpawnInput({
    module: AOS_MODULE,
    scheduler: DEFAULT_SCHEDULER,
    onBoot: true,
    tags: [
      { name: 'Authority', value: AO_AUTHORITY },
      { name: 'Name', value: 'BANKON-Marketspace' },
      { name: 'Initial-Controller', value: address },
      { name: 'Treasury', value: address },
      { name: 'Bnr-Process-Id', value: bnrId },
    ],
    data: BMR_LUA_SOURCE,
  });
  const signed = await signDataItemWith({ ...spawnInput, owner: key.owner }, key.sign).finally(() => key.dispose());
  log(`Signed (id=${signed.id}). Posting...`);

  setAoEndpoints({ mu: AO_MAINNET_MU, cu: AR_IO_CU });
  await aoSpawn(signed);
  log('Posted. Polling for confirmation...');

  const deadline = Date.now() + SPAWN_TIMEOUT_MS;
  let confirmed = false;
  while (Date.now() < deadline) {
    try {
      await aoResult({ message: signed.id, process: signed.id });
      confirmed = true;
      break;
    } catch {
      await sleep(2500);
    }
  }
  if (!confirmed) {
    log(`Spawn ${signed.id} not confirmed within ${SPAWN_TIMEOUT_MS / 1000}s.`);
    return;
  }
  setBmrProcessId(signed.id);
  log(`BMR live at process ${signed.id}.`);
  toast('Marketspace Registry spawned', 'success');
  root.appendChild(el('div', {
    cls: 'parsec-confirm__actions',
    children: [
      btn('Open Marketspace', {
        intent: 'primary',
        onClick: () => store.navigate('market-hub'),
      }),
    ],
  }));
}

function renderInfo(into: HTMLElement, info: BnrInfo): void {
  into.innerHTML = '';
  into.appendChild(el('h4', { text: `${info.name} v${info.version}` }));
  into.appendChild(row('Process id', truncAddr(getBnrProcessId())));
  into.appendChild(row('Records', String(info.recordCount)));
  into.appendChild(row('Reserved', String(info.reservedCount)));
  into.appendChild(row('Open beta', info.policy.OpenBeta ? 'yes' : 'no'));
  into.appendChild(row('Lease bounds', `${info.policy.LeaseYearsMin}-${info.policy.LeaseYearsMax} years`));
  into.appendChild(row('Accepted methods', info.policy.AcceptedMethods.join(', ')));
  into.appendChild(row('Controllers', info.controllers.map(truncAddr).join(', ')));
  into.appendChild(row('Treasury (Arweave)', truncAddr(info.treasury['arweave-stake'] ?? '—')));
  into.appendChild(row('Treasury (Algorand)', info.treasury['algorand'] ?? '—'));
}

function buildGovernanceForms(address: string, info: BnrInfo): HTMLElement {
  const container = el('div', {});

  // ── Set-Policy ─────────────────────────────────────────────
  const openBetaToggle = input({
    type: 'checkbox',
    cls: '',
  });
  openBetaToggle.checked = info.policy.OpenBeta;
  const leaseMinIn = input({ placeholder: 'min years', cls: 'bp5-input', value: String(info.policy.LeaseYearsMin) });
  const leaseMaxIn = input({ placeholder: 'max years', cls: 'bp5-input', value: String(info.policy.LeaseYearsMax) });

  container.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Set policy' }),
      el('label', { children: [openBetaToggle, ' Open beta (free claims accepted)'] }),
      el('label', { text: 'Lease year bounds' }),
      el('div', { children: [leaseMinIn, ' to ', leaseMaxIn] }),
      btn('Submit Set-Policy', {
        onClick: async () => {
          await submit(address, buildSetPolicyInput({
            openBeta: openBetaToggle.checked,
            leaseYearsMin: parseInt(leaseMinIn.value, 10) || info.policy.LeaseYearsMin,
            leaseYearsMax: parseInt(leaseMaxIn.value, 10) || info.policy.LeaseYearsMax,
          }), 'Policy updated');
        },
      }),
    ],
  }));

  // ── Set-Treasury ───────────────────────────────────────────
  const treasuryMethodSelect = el('select', {
    cls: 'bp5-input',
    children: ['arweave-stake', 'algorand', 'bankon'].map((v) =>
      el('option', { attrs: { value: v }, text: v }),
    ),
  }) as HTMLSelectElement;
  const treasuryAddrIn = input({ placeholder: 'address', cls: 'bp5-input bp5-fill' });
  container.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Set treasury' }),
      el('label', { text: 'Payment method' }),
      treasuryMethodSelect,
      el('label', { text: 'Treasury address' }),
      treasuryAddrIn,
      btn('Submit Set-Treasury', {
        onClick: async () => {
          if (!treasuryAddrIn.value.trim()) { toast('Address required', 'warning'); return; }
          await submit(address, buildSetTreasuryInput({
            paymentMethod: treasuryMethodSelect.value as PaymentMethod,
            address: treasuryAddrIn.value.trim(),
          }), 'Treasury updated');
        },
      }),
    ],
  }));

  // ── Add / Remove controller ───────────────────────────────
  const addCtrlIn = input({ placeholder: 'Arweave address to add', cls: 'bp5-input bp5-fill' });
  const removeCtrlIn = input({ placeholder: 'Arweave address to remove', cls: 'bp5-input bp5-fill' });
  container.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Controllers' }),
      addCtrlIn,
      btn('Add controller', {
        onClick: async () => {
          if (!addCtrlIn.value.trim()) { toast('Address required', 'warning'); return; }
          await submit(address, buildAddControllerInput({ address: addCtrlIn.value.trim() }), 'Controller added');
        },
      }),
      removeCtrlIn,
      btn('Remove controller', {
        intent: 'danger',
        onClick: async () => {
          if (!removeCtrlIn.value.trim()) { toast('Address required', 'warning'); return; }
          await submit(address, buildRemoveControllerInput({ address: removeCtrlIn.value.trim() }), 'Controller removed');
        },
      }),
    ],
  }));

  // ── Set-Reserved ──────────────────────────────────────────
  const reservedNameIn = input({ placeholder: 'name to reserve', cls: 'bp5-input bp5-fill' });
  const reservedTargetIn = input({ placeholder: 'optional target address', cls: 'bp5-input bp5-fill' });
  const reservedReasonIn = input({ placeholder: 'optional reason', cls: 'bp5-input bp5-fill' });
  container.appendChild(el('div', {
    cls: 'parsec-confirm__details',
    children: [
      el('h4', { text: 'Reserve a name' }),
      reservedNameIn,
      reservedTargetIn,
      reservedReasonIn,
      btn('Submit Set-Reserved', {
        onClick: async () => {
          const name = reservedNameIn.value.trim().toLowerCase();
          if (!name) { toast('Name required', 'warning'); return; }
          await submit(address, buildSetReservedInput({
            name,
            target: reservedTargetIn.value.trim() || undefined,
            reason: reservedReasonIn.value.trim() || undefined,
          }), `Reserved "${name}"`);
        },
      }),
    ],
  }));

  return container;
}

async function submit(
  address: string,
  input: Awaited<ReturnType<typeof buildSetPolicyInput>>,
  successToast: string,
): Promise<void> {
  const passphrase = store.getPassphrase();
  if (!passphrase) {
    toast('Wallet is locked', 'danger');
    store.navigate('unlock');
    return;
  }
  try {
    const signed = await signDataItemFromVault(address, passphrase, input);
    await aoMessage(signed);
    toast(successToast, 'success');
  } catch (e) {
    toast(`Submit failed: ${e instanceof Error ? e.message : String(e)}`, 'danger');
  }
}

// ── Helpers ────────────────────────────────────────────────────

function row(label: string, value: string | HTMLElement): HTMLElement {
  const valueNode = typeof value === 'string'
    ? el('span', { cls: 'parsec-confirm__value', text: value })
    : value;
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [el('span', { cls: 'parsec-confirm__label', text: label }), valueNode],
  });
}

function truncAddr(a: string): string {
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}...${a.slice(-6)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
