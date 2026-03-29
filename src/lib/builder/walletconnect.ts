// PARSEC — WalletConnect Module
// Multi-family support: Algorand, EVM (all chains), UTXO, Solana (future).
// External wallet bridge — PARSEC never touches the remote wallet's keys.
// CLI + Desktop compatible via @walletconnect/sign-client
// (c) 2026 BANKON — GPL-3.0

import type {
  ChainFamily,
  WCMetadata,
  WCNamespace,
  WCSession,
  WCAccounts,
  EthTxRequest,
} from './types';
import { getChain } from './registry';

// ── SignClient interface (no hard dependency) ────────────────

interface WCSignClient {
  connect(opts: { requiredNamespaces: Record<string, WCNamespace> }): Promise<{ uri?: string; approval: () => Promise<WCSession> }>;
  disconnect(opts: { topic: string; reason: { code: number; message: string } }): Promise<void>;
  request(opts: { topic: string; chainId: string; request: { method: string; params: unknown[] } }): Promise<unknown>;
  session: { getAll(): WCSession[] };
  on(event: string, handler: (data: unknown) => void): void;
}

interface WCSignClientInit {
  init(opts: { projectId: string; metadata: WCMetadata }): Promise<WCSignClient>;
}

// ── Configuration ────────────────────────────────────────────

export interface WalletConnectConfig {
  projectId?: string;
  metadata?: WCMetadata;
  onQRCode?: (uri: string) => void;
  onSessionDelete?: () => void;
  onAccountsChanged?: (accounts: WCAccounts) => void;
}

const DEFAULT_METADATA: WCMetadata = {
  name: 'PARSEC',
  description: 'Universal Wallet',
  url: 'https://parsec.wallet',
  icons: [],
};

// ── PARSEC WalletConnect ─────────────────────────────────────

export class ParsecWalletConnect {
  private projectId: string;
  private metadata: WCMetadata;
  private onQRCode: ((uri: string) => void) | null;
  private onSessionDelete: (() => void) | null;
  private onAccountsChanged: ((accounts: WCAccounts) => void) | null;

  private client: WCSignClient | null = null;
  private session: WCSession | null = null;

  constructor(config: WalletConnectConfig = {}) {
    this.projectId = config.projectId ?? '';
    this.metadata = config.metadata ?? DEFAULT_METADATA;
    this.onQRCode = config.onQRCode ?? null;
    this.onSessionDelete = config.onSessionDelete ?? null;
    this.onAccountsChanged = config.onAccountsChanged ?? null;
  }

  // ── Init ─────────────────────────────────────────────────

  async init(): Promise<void> {
    if (!this.projectId) throw new Error('WalletConnect projectId required');

    // @ts-expect-error — @walletconnect/sign-client is an optional runtime dependency
    const SignClient = await import('@walletconnect/sign-client') as unknown as WCSignClientInit;

    this.client = await SignClient.init({
      projectId: this.projectId,
      metadata: this.metadata,
    });

    this.registerEvents();
  }

  // ── Connect ──────────────────────────────────────────────
  // Specify which chain families and specific EVM chain IDs to request.

  async connect(opts: {
    families?: ChainFamily[];
    evmChainIds?: number[];
  } = {}): Promise<WCAccounts> {
    if (!this.client) throw new Error('Call init() first');

    const families = opts.families ?? ['algorand', 'evm'];
    const evmChainIds = opts.evmChainIds ?? [1]; // default: Ethereum mainnet

    const namespaces = this.buildNamespaces(families, evmChainIds);

    const { uri, approval } = await this.client.connect({
      requiredNamespaces: namespaces,
    });

    if (uri && this.onQRCode) {
      this.onQRCode(uri);
    }

    this.session = await approval();
    const accounts = this.getAccounts();
    this.onAccountsChanged?.(accounts);
    return accounts;
  }

  // ── Reconnect ────────────────────────────────────────────

  reconnect(): WCAccounts | null {
    if (!this.client) return null;

    const sessions = this.client.session.getAll();
    if (!sessions.length) return null;

    this.session = sessions[0];
    return this.getAccounts();
  }

  // ── Disconnect ───────────────────────────────────────────

  async disconnect(): Promise<void> {
    if (!this.client || !this.session) return;

    await this.client.disconnect({
      topic: this.session.topic,
      reason: { code: 6000, message: 'User disconnected' },
    });

    this.session = null;
  }

  // ── Sign Transaction ─────────────────────────────────────
  // Routes to the correct WC method based on chain family.

  async signTransaction(request: {
    chainId: string;
    txn: Uint8Array | EthTxRequest;
  }): Promise<unknown> {
    if (!this.client || !this.session) throw new Error('No active session');

    const chain = getChain(request.chainId);
    if (!chain) throw new Error(`Unknown chain: ${request.chainId}`);

    switch (chain.family) {
      case 'algorand':
        return this.signAlgorand(request.txn as Uint8Array);
      case 'evm':
        return this.signEVM(request.txn as EthTxRequest, chain.networkId ?? 1);
      default:
        throw new Error(`WalletConnect signing not supported for ${chain.family}`);
    }
  }

  // ── Personal Sign (EVM message signing) ──────────────────

  async personalSign(address: string, message: string, evmChainId = 1): Promise<string> {
    if (!this.client || !this.session) throw new Error('No active session');

    return await this.client.request({
      topic: this.session.topic,
      chainId: `eip155:${evmChainId}`,
      request: {
        method: 'personal_sign',
        params: [message, address],
      },
    }) as string;
  }

  // ── State ────────────────────────────────────────────────

  get isConnected(): boolean {
    return this.session !== null;
  }

  get topic(): string | null {
    return this.session?.topic ?? null;
  }

  // ── Algorand Signing ─────────────────────────────────────

  private async signAlgorand(txn: Uint8Array): Promise<unknown> {
    const encoded = btoa(String.fromCharCode(...txn));

    return this.client!.request({
      topic: this.session!.topic,
      chainId: 'algorand:mainnet',
      request: {
        method: 'algo_signTxn',
        params: [[{ txn: encoded }]],
      },
    });
  }

  // ── EVM Signing ──────────────────────────────────────────

  private async signEVM(txn: EthTxRequest, chainId: number): Promise<unknown> {
    return this.client!.request({
      topic: this.session!.topic,
      chainId: `eip155:${chainId}`,
      request: {
        method: 'eth_sendTransaction',
        params: [txn],
      },
    });
  }

  // ── Namespace Builder ────────────────────────────────────
  // Builds WC namespaces for requested families + specific EVM chains.

  private buildNamespaces(
    families: ChainFamily[],
    evmChainIds: number[],
  ): Record<string, WCNamespace> {
    const namespaces: Record<string, WCNamespace> = {};

    if (families.includes('algorand')) {
      namespaces.algorand = {
        methods: ['algo_signTxn'],
        chains: ['algorand:mainnet'],
        events: [],
      };
    }

    if (families.includes('evm')) {
      namespaces.eip155 = {
        methods: [
          'eth_sendTransaction',
          'eth_sign',
          'personal_sign',
          'eth_signTypedData',
        ],
        chains: evmChainIds.map(id => `eip155:${id}`),
        events: ['accountsChanged', 'chainChanged'],
      };
    }

    return namespaces;
  }

  // ── Account Extraction ───────────────────────────────────

  private getAccounts(): WCAccounts {
    if (!this.session) return {};

    const accounts: WCAccounts = {};

    for (const ns of Object.keys(this.session.namespaces)) {
      const addrs = this.session.namespaces[ns].accounts.map(acc => acc.split(':')[2]);
      accounts[ns] = addrs;
    }

    return accounts;
  }

  // ── Event Registration ───────────────────────────────────

  private registerEvents(): void {
    if (!this.client) return;

    this.client.on('session_delete', () => {
      this.session = null;
      this.onSessionDelete?.();
    });

    this.client.on('session_update', (updated: unknown) => {
      this.session = updated as WCSession;
      this.onAccountsChanged?.(this.getAccounts());
    });
  }
}
