// Unified named-NFT mint flow for both AR.IO and BANKON namespaces.
//
// Entered via ?name= + ?namespace=arns|bankon (passed through sessionStorage
// since the wallet's router doesn't pass query params yet). Flow:
//   1. Pick a standard or aORC token type.
//   2. Fill metadata (name, unit, url, traits, CID for THOT).
//   3. Mint via algosdk (or TypeMinter for type-aware mints).
//   4. Optionally upload a binding-proof JSON to Arweave.
//   5. Bind the resulting Algorand asset id into the name's records
//      (Set-Record on ANT for ArNS, Set-Record on BNR for BANKON).
//
// See docs/named-nft-binding.md for the cross-chain binding spec.

import { el, btn, input, toast } from '../lib/dom';
import { store, getAccountAddress } from '../lib/store';
import {
  isAorcConfigured,
  isCidMinted,
  signAndSendMint,
  signAndSendTypeMint,
  type AorcMintMeta,
  type AorcMintResult,
  type AorcNftStandard,
  type AorcTokenType,
} from '../lib/aorc';
import { buildArweaveSigner, type ArweaveSigner } from '../lib/arweave/signer';
import { setAntRootRecord, setAntUndername } from '../lib/arweave/ant';
import { getArnsRecord } from '../lib/arweave/ario';
import {
  buildSetBankonRecordInput,
} from '../lib/bankon-names/client';
import { signDataItemFromVault } from '../lib/arweave/ans104';
import { aoMessage } from '../lib/arweave/ao';
import { uploadData } from '../lib/arweave/tx';

type Namespace = 'arns' | 'bankon';
type MintKind = AorcNftStandard | AorcTokenType;

interface State {
  phase: 'configure' | 'minting' | 'binding' | 'done' | 'failed';
  namespace: Namespace;
  name: string;
  kind: MintKind;
  meta: AorcMintMeta;
  controller: string;       // dNFT only
  modelId: string;          // iNFT only (string for input ergonomics)
  cid: string;              // THOT only
  bindSub: string;          // subdomain to bind on (default '@asa')
  mintResult?: AorcMintResult;
  proofTxId?: string;
  bindMessageId?: string;
  error?: string;
  log: string[];
}

const STANDARD_KINDS: MintKind[] = ['arc-3', 'arc-19', 'arc-69'];
const TYPE_KINDS: MintKind[] = ['aNFT', 'dNFT', 'iNFT', 'THOT'];

export function nameMintView(): HTMLElement {
  const root = el('div', { cls: 'parsec-view parsec-confirm' });

  const namespace = (sessionStorage.getItem('parsec:name-mint-namespace') as Namespace) || 'arns';
  const name = sessionStorage.getItem('parsec:name-mint-name') ?? '';
  // Clear after reading so a refresh doesn't re-prefill stale state.

  const state: State = {
    phase: 'configure',
    namespace,
    name,
    kind: 'arc-19',
    meta: { name: '', unitName: '', total: 1, decimals: 0, url: '' },
    controller: '',
    modelId: '',
    cid: '',
    bindSub: '@asa',
    log: [],
  };

  function logLine(m: string): void {
    state.log.push(`[${new Date().toLocaleTimeString()}] ${m}`);
    render();
  }

  function render(): void {
    root.innerHTML = '';
    root.appendChild(el('div', {
      cls: 'parsec-view__header',
      children: [
        btn('Back', {
          minimal: true,
          icon: 'arrow-left',
          onClick: () => store.navigate(state.namespace === 'arns' ? 'ario-name' : 'bankon-name'),
        }),
        el('h2', {
          cls: 'parsec-view__title',
          text: state.name ? `Mint to "${state.name}"` : 'Bind an NFT',
        }),
      ],
    }));

    if (!state.name) {
      root.appendChild(el('p', { cls: 'parsec-empty', text: 'No name selected. Return to the per-name view to start.' }));
      return;
    }

    if (state.phase === 'configure') root.appendChild(buildConfigurePanel());
    if (state.phase === 'minting') root.appendChild(buildBusyPanel('Minting on Algorand...'));
    if (state.phase === 'binding') root.appendChild(buildBusyPanel('Binding to name records...'));
    if (state.phase === 'done') root.appendChild(buildDonePanel());
    if (state.phase === 'failed') root.appendChild(buildFailedPanel());

    if (state.log.length > 0) {
      root.appendChild(el('pre', {
        cls: 'parsec-confirm__details',
        attrs: { style: 'white-space: pre-wrap; max-height: 200px; overflow: auto;' },
        text: state.log.join('\n'),
      }));
    }
  }

  function buildConfigurePanel(): HTMLElement {
    const network = store.get().settings.network;
    const typeMinterAvailable = isAorcConfigured(network);

    const kindSelect = el('select', {
      cls: 'bp5-input',
      children: [
        el('option', { attrs: { disabled: 'disabled' }, text: '— Standard NFTs —' }),
        ...STANDARD_KINDS.map((k) => el('option', { attrs: { value: k, ...(k === state.kind ? { selected: 'selected' } : {}) }, text: k })),
        el('option', { attrs: { disabled: 'disabled' }, text: '— aORC Types —' }),
        ...TYPE_KINDS.map((k) => el('option', {
          attrs: {
            value: k,
            ...(k === state.kind ? { selected: 'selected' } : {}),
            ...(typeMinterAvailable ? {} : { disabled: 'disabled' }),
          },
          text: typeMinterAvailable ? k : `${k} (TypeMinter not on ${network})`,
        })),
      ],
    }) as HTMLSelectElement;
    kindSelect.addEventListener('change', () => {
      state.kind = kindSelect.value as MintKind;
      render();
    });

    const nameInput = input({ placeholder: 'asset name (≤ 32 chars)', cls: 'bp5-input bp5-fill', value: state.meta.name, onInput: (v) => { state.meta.name = v.slice(0, 32); } });
    const unitInput = input({ placeholder: 'unit name (≤ 8 chars)', cls: 'bp5-input', value: state.meta.unitName, onInput: (v) => { state.meta.unitName = v.slice(0, 8); } });
    const urlInput = input({ placeholder: 'metadata URL or ipfs://CID', cls: 'bp5-input bp5-fill', value: state.meta.url ?? '', onInput: (v) => { state.meta.url = v.trim() || undefined; } });
    const totalInput = input({ placeholder: 'total supply (1 for NFT)', cls: 'bp5-input', value: String(state.meta.total), onInput: (v) => { state.meta.total = Math.max(1, parseInt(v, 10) || 1); } });
    const decimalsInput = input({ placeholder: 'decimals (0 for NFT)', cls: 'bp5-input', value: String(state.meta.decimals), onInput: (v) => { state.meta.decimals = Math.max(0, parseInt(v, 10) || 0); } });

    const fields: HTMLElement[] = [
      el('label', { text: 'Kind' }),
      kindSelect,
      el('label', { text: 'Name' }),
      nameInput,
      el('label', { text: 'Unit name' }),
      unitInput,
      el('label', { text: 'Total / Decimals' }),
      el('div', { children: [totalInput, ' ', decimalsInput] }),
      el('label', { text: 'Metadata URL' }),
      urlInput,
    ];

    if (state.kind === 'dNFT') {
      const ctrlInput = input({ placeholder: 'controller Algorand address', cls: 'bp5-input bp5-fill', value: state.controller, onInput: (v) => { state.controller = v.trim(); } });
      fields.push(el('label', { text: 'Controller (dNFT)' }), ctrlInput);
    }
    if (state.kind === 'iNFT') {
      const modelInput = input({ placeholder: 'model id (uint64)', cls: 'bp5-input', value: state.modelId, onInput: (v) => { state.modelId = v.trim(); } });
      fields.push(el('label', { text: 'Model id (iNFT)' }), modelInput);
    }
    if (state.kind === 'THOT') {
      const cidInput = input({ placeholder: 'IPFS CID (unique on the Registry)', cls: 'bp5-input bp5-fill', value: state.cid, onInput: (v) => { state.cid = v.trim(); } });
      fields.push(el('label', { text: 'CID (THOT)' }), cidInput);
    }

    const subInput = input({ placeholder: 'subdomain to bind on (default @asa)', cls: 'bp5-input', value: state.bindSub, onInput: (v) => { state.bindSub = v.trim() || '@asa'; } });
    fields.push(el('label', { text: 'Bind to subdomain' }), subInput);

    return el('div', {
      children: [
        el('p', {
          cls: 'parsec-view__desc',
          text: `Mint an Algorand asset and bind it to "${state.name}" in the ${state.namespace.toUpperCase()} namespace. The name's record carries an Arweave-side proof tx pointing at the asset id.`,
        }),
        el('div', { cls: 'parsec-confirm__details', children: fields }),
        el('div', {
          cls: 'parsec-confirm__actions',
          children: [
            btn('Cancel', {
              outlined: true,
              large: true,
              onClick: () => store.navigate(state.namespace === 'arns' ? 'ario-name' : 'bankon-name'),
            }),
            btn('Mint + bind', {
              intent: 'primary',
              large: true,
              icon: 'plus',
              onClick: () => void mintAndBind(),
            }),
          ],
        }),
      ],
    });
  }

  function buildBusyPanel(text: string): HTMLElement {
    return el('div', {
      cls: 'parsec-callout bp5-callout bp5-intent-primary',
      children: [el('p', { text })],
    });
  }

  function buildDonePanel(): HTMLElement {
    return el('div', {
      children: [
        el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-success',
          children: [el('p', { text: `Asset ${state.mintResult?.assetId} bound to "${state.name}" under "${state.bindSub}".` })],
        }),
        el('div', {
          cls: 'parsec-confirm__details',
          children: [
            row('Asset id', String(state.mintResult?.assetId ?? '—')),
            row('Mint tx', state.mintResult?.txId ?? '—'),
            state.proofTxId ? row('Binding proof (Arweave)', state.proofTxId) : el('span', {}),
            state.bindMessageId ? row('Bind message id', state.bindMessageId) : el('span', {}),
          ].filter(node => (node as HTMLElement).childNodes.length > 0) as HTMLElement[],
        }),
        btn('Back to name', {
          intent: 'primary',
          onClick: () => store.navigate(state.namespace === 'arns' ? 'ario-name' : 'bankon-name'),
        }),
      ],
    });
  }

  function buildFailedPanel(): HTMLElement {
    return el('div', {
      children: [
        el('div', {
          cls: 'parsec-callout bp5-callout bp5-intent-danger',
          children: [el('p', { text: state.error ?? 'Unknown failure' })],
        }),
        btn('Back', {
          intent: 'primary',
          onClick: () => store.navigate(state.namespace === 'arns' ? 'ario-name' : 'bankon-name'),
        }),
      ],
    });
  }

  async function mintAndBind(): Promise<void> {
    if (!state.meta.name || !state.meta.unitName) {
      toast('Name and unit-name are required', 'warning');
      return;
    }

    const s = store.get();
    const account = s.accounts[s.activeAccountIndex];
    const arweaveAddr = account
      ? (getAccountAddress(account, 'arweave-hd') ?? getAccountAddress(account, 'arweave'))
      : undefined;
    const algorandAddr = account ? getAccountAddress(account, 'algorand') ?? account.address : undefined;

    if (!arweaveAddr) {
      toast('No Arweave address — binding to a name requires one', 'danger');
      return;
    }
    if (!algorandAddr) {
      toast('No Algorand address — minting requires one', 'danger');
      return;
    }
    const passphrase = store.getPassphrase();
    if (!passphrase) {
      toast('Wallet is locked', 'danger');
      store.navigate('unlock');
      return;
    }

    // THOT uniqueness pre-check.
    if (state.kind === 'THOT') {
      if (!state.cid) { toast('CID required for THOT', 'warning'); return; }
      if (await isCidMinted(state.cid, s.settings.network)) {
        state.error = `CID already minted as THOT: ${state.cid}`;
        state.phase = 'failed';
        render();
        return;
      }
    }

    state.phase = 'minting';
    render();
    logLine(`Minting ${state.kind}...`);

    let mintResult: AorcMintResult;
    try {
      if (STANDARD_KINDS.includes(state.kind)) {
        mintResult = await signAndSendMint({
          creator: algorandAddr,
          passphrase,
          standard: state.kind as AorcNftStandard,
          meta: state.meta,
          network: s.settings.network,
        });
      } else {
        mintResult = await signAndSendTypeMint({
          creator: algorandAddr,
          passphrase,
          type: state.kind as AorcTokenType,
          meta: state.meta,
          controller: state.controller || undefined,
          modelId: state.modelId ? Number(state.modelId) : undefined,
          cid: state.cid || undefined,
          network: s.settings.network,
        });
      }
      state.mintResult = mintResult;
      logLine(`Minted asset ${mintResult.assetId} (tx ${mintResult.txId.slice(0, 12)}...).`);
    } catch (e) {
      state.error = e instanceof Error ? e.message : String(e);
      state.phase = 'failed';
      render();
      return;
    }

    state.phase = 'binding';
    render();

    // Upload the binding proof to Arweave.
    let proofTxId: string;
    try {
      logLine('Uploading binding proof to Arweave...');
      const proof = {
        chain: 'algorand',
        network: s.settings.network,
        assetId: mintResult.assetId,
        asaCreator: algorandAddr,
        mintTxId: mintResult.txId,
        standard: state.kind,
        traits: state.meta.traits ?? [],
        name: state.name,
        namespace: state.namespace,
        boundAt: Date.now(),
      };
      const receipt = await uploadData(arweaveAddr, passphrase, {
        data: JSON.stringify(proof, null, 2),
        tags: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'App-Name', value: 'parsec-wallet' },
          { name: 'App-Version', value: __APP_VERSION__ },
          { name: 'Type', value: 'named-nft-binding' },
          { name: 'Namespace', value: state.namespace },
          { name: 'Name', value: state.name },
          { name: 'Algorand-Asset-Id', value: String(mintResult.assetId) },
          { name: 'Algorand-Network', value: s.settings.network },
        ],
      });
      proofTxId = receipt.id;
      state.proofTxId = proofTxId;
      logLine(`Proof uploaded: ${proofTxId}`);
    } catch (e) {
      state.error = `Proof upload failed: ${e instanceof Error ? e.message : String(e)}`;
      state.phase = 'failed';
      render();
      return;
    }

    // Bind to the name.
    try {
      logLine(`Binding ${state.bindSub} → ${proofTxId} on the ${state.namespace.toUpperCase()} name...`);
      if (state.namespace === 'arns') {
        const record = await getArnsRecord(state.name);
        if (!record) throw new Error(`ArNS record for "${state.name}" not found`);
        const signer: ArweaveSigner = await buildArweaveSigner(arweaveAddr, passphrase);
        try {
          if (state.bindSub === '@' || state.bindSub === '@asa') {
            await setAntRootRecord({ signer, antProcessId: record.processId, transactionId: proofTxId });
          } else {
            await setAntUndername({ signer, antProcessId: record.processId, subdomain: state.bindSub, transactionId: proofTxId });
          }
        } finally {
          signer.dispose();
        }
        logLine('ArNS record bound.');
      } else {
        const bindInput = buildSetBankonRecordInput({
          name: state.name,
          subdomain: state.bindSub === '@asa' ? '@' : state.bindSub,
          transactionId: proofTxId,
        });
        const signed = await signDataItemFromVault(arweaveAddr, passphrase, bindInput);
        state.bindMessageId = signed.id;
        await aoMessage(signed);
        logLine('BANKON record bound.');
      }
      state.phase = 'done';
      render();
    } catch (e) {
      state.error = `Binding failed: ${e instanceof Error ? e.message : String(e)}`;
      state.phase = 'failed';
      render();
    }
  }

  render();
  return root;
}

function row(label: string, value: string | HTMLElement): HTMLElement {
  const valueNode = typeof value === 'string'
    ? el('span', { cls: 'parsec-confirm__value', text: value })
    : value;
  return el('div', {
    cls: 'parsec-confirm__row',
    children: [el('span', { cls: 'parsec-confirm__label', text: label }), valueNode],
  });
}
