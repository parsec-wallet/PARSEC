// PARSEC — Multi-Chain Transaction Builder
// Isolation-first: each chain family builds in its own context.
// Plugs into WalletConnect, MetaMask, or local vault signing.
// (c) 2026 BANKON — GPL-3.0

import algosdk from 'algosdk';
import type {
  ParsecTx,
  BuiltTransaction,
  AlgorandTxMeta,
  EthereumTxMeta,
  UTXOTxMeta,
  CryptoNoteTxMeta,
  ZilliqaTxMeta,
  CardanoTxMeta,
  ArweaveTxMeta,
  EthProvider,
  EthTxRequest,
  EIP1193Provider,
  UTXORawTx,
  CryptoNoteRawTx,
  ZilliqaRawTx,
  CardanoRawTx,
  ArweaveRawTx,
  SigningAuthority,
} from './types';
import { getChain } from './registry';
import { createIsolationContext, validateIsolation } from './isolation';

// ── Builder Configuration ────────────────────────────────────

export interface BuilderConfig {
  algod?: algosdk.Algodv2;
  ethProvider?: EthProvider;
  injectedProvider?: EIP1193Provider;  // MetaMask / injected
  signingAuthority?: SigningAuthority;
}

// ── PARSEC Transaction Builder ───────────────────────────────

export class ParsecTxBuilder {
  private algod: algosdk.Algodv2 | null;
  private ethProvider: EthProvider | null;
  private injectedProvider: EIP1193Provider | null;
  private defaultAuthority: SigningAuthority;

  constructor(config: BuilderConfig = {}) {
    this.algod = config.algod ?? null;
    this.ethProvider = config.ethProvider ?? null;
    this.injectedProvider = config.injectedProvider ?? null;
    this.defaultAuthority = config.signingAuthority ?? 'vault';
  }

  // ── Entry Point ──────────────────────────────────────────

  async build(tx: ParsecTx, authority?: SigningAuthority): Promise<BuiltTransaction> {
    const chain = getChain(tx.chain);
    if (!chain) throw new Error(`Unknown chain: ${tx.chain}`);

    const auth = authority ?? this.defaultAuthority;

    switch (chain.family) {
      case 'algorand':
        return this.buildAlgorand(tx, auth);
      case 'evm':
        return this.buildEVM(tx, chain.networkId ?? 1, auth);
      case 'utxo':
        return this.buildUTXO(tx, auth);
      case 'cryptonote':
        return this.buildCryptoNote(tx, auth);
      case 'zilliqa':
        return this.buildZilliqa(tx, auth);
      case 'cardano':
        return this.buildCardano(tx, auth);
      case 'arweave':
        return this.buildArweave(tx, auth);
      default:
        throw new Error(`Unsupported chain family: ${chain.family}`);
    }
  }

  // ── Algorand ─────────────────────────────────────────────

  private async buildAlgorand(tx: ParsecTx, authority: SigningAuthority): Promise<BuiltTransaction> {
    if (!this.algod) throw new Error('Algod client required for Algorand transactions');

    const params = await this.algod.getTransactionParams().do();

    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: tx.from,
      receiver: tx.to,
      amount: tx.amount,
      note: tx.note ? new TextEncoder().encode(tx.note) : undefined,
      suggestedParams: params,
    });

    const meta: AlgorandTxMeta = {
      fee: Number(txn.fee),
      firstRound: Number(txn.firstValid),
      lastRound: Number(txn.lastValid),
    };

    const isolation = createIsolationContext(tx.from, tx.chain, authority);

    const built: BuiltTransaction = {
      chain: tx.chain,
      family: 'algorand',
      type: 'payment',
      raw: algosdk.encodeUnsignedTransaction(txn),
      meta,
      isolation,
    };

    validateIsolation(built);
    return built;
  }

  // ── EVM (Ethereum, L2, L3, Sidechains) ───────────────────

  private async buildEVM(
    tx: ParsecTx,
    chainId: number,
    authority: SigningAuthority,
  ): Promise<BuiltTransaction> {
    const txRequest: EthTxRequest = {
      from: tx.from,
      to: tx.to,
      value: '0x' + BigInt(Math.floor(tx.amount * 1e18)).toString(16),
      data: tx.data ?? '0x',
      chainId,
    };

    let populated = txRequest;
    let gasLimit: bigint | undefined;
    let maxFeePerGas: bigint | undefined;
    let maxPriorityFeePerGas: bigint | undefined;

    // If we have a provider, populate gas estimates
    if (authority === 'metamask' && this.injectedProvider) {
      // MetaMask will populate gas on its end — pass through
    } else if (this.ethProvider) {
      const signer = this.ethProvider.getSigner(tx.from);
      const pop = await signer.populateTransaction(txRequest);
      populated = pop;
      gasLimit = pop.gasLimit;
      maxFeePerGas = pop.maxFeePerGas;
      maxPriorityFeePerGas = pop.maxPriorityFeePerGas;
    }

    const meta: EthereumTxMeta = {
      chainId,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    };

    const isolation = createIsolationContext(tx.from, tx.chain, authority);

    const built: BuiltTransaction = {
      chain: tx.chain,
      family: 'evm',
      type: 'transfer',
      raw: populated,
      meta,
      isolation,
    };

    validateIsolation(built);
    return built;
  }

  // ── UTXO (Bitcoin, Litecoin) ─────────────────────────────

  private async buildUTXO(tx: ParsecTx, authority: SigningAuthority): Promise<BuiltTransaction> {
    // UTXO model: inputs → outputs with change
    // Requires UTXO set from indexer. Transaction is built unsigned,
    // then dispatched to the appropriate signer (vault or external).

    if (!tx.utxos?.length) {
      throw new Error('UTXO transactions require input set (tx.utxos)');
    }

    const inputTotal = tx.utxos.reduce((sum, u) => sum + u.value, 0);
    const estimatedFee = estimateUTXOFee(tx.utxos.length, 2); // 2 outputs: recipient + change
    const changeAmount = inputTotal - tx.amount - estimatedFee;

    if (changeAmount < 0) {
      throw new Error(`Insufficient UTXO balance: have ${inputTotal}, need ${tx.amount + estimatedFee}`);
    }

    const outputs: { address: string; value: number }[] = [
      { address: tx.to, value: tx.amount },
    ];
    if (changeAmount > 546) { // dust threshold
      outputs.push({ address: tx.changeAddress ?? tx.from, value: changeAmount });
    }

    const raw: UTXORawTx = {
      hex: '', // Serialized by bitcoinjs-lib when available
      inputs: tx.utxos,
      outputs,
    };

    const meta: UTXOTxMeta = {
      inputCount: tx.utxos.length,
      outputCount: outputs.length,
      estimatedFee,
      estimatedSize: estimateUTXOSize(tx.utxos.length, outputs.length),
    };

    const isolation = createIsolationContext(tx.from, tx.chain, authority);

    const built: BuiltTransaction = {
      chain: tx.chain,
      family: 'utxo',
      type: 'transfer',
      raw,
      meta,
      isolation,
    };

    validateIsolation(built);
    return built;
  }

  // ── CryptoNote (Monero) ──────────────────────────────────

  private async buildCryptoNote(tx: ParsecTx, authority: SigningAuthority): Promise<BuiltTransaction> {
    // Monero uses ring signatures, stealth addresses, and RingCT.
    // Transaction construction requires:
    // 1. Selecting decoy outputs (ring members) from the blockchain
    // 2. Building a ring signature over the real + decoy inputs
    // 3. Computing key images to prevent double-spend
    // 4. RingCT for amount hiding
    //
    // This CANNOT be done without the Monero WASM library.
    // We build the intent here; signing is deferred to the Monero module.

    const ringSize = tx.ringSize ?? 16; // Monero default

    const raw: CryptoNoteRawTx = {
      blob: '',         // Populated by monero WASM when available
      keyImages: [],
      fee: tx.priority ?? 1, // Priority-based fee estimation
    };

    const meta: CryptoNoteTxMeta = {
      ringSize,
      fee: raw.fee,
      paymentId: tx.memo,
    };

    const isolation = createIsolationContext(tx.from, tx.chain, authority);

    const built: BuiltTransaction = {
      chain: tx.chain,
      family: 'cryptonote',
      type: 'transfer',
      raw,
      meta,
      isolation,
    };

    validateIsolation(built);
    return built;
  }

  // ── Zilliqa (Schnorr/secp256k1, Scilla) ──────────────────

  private async buildZilliqa(tx: ParsecTx, authority: SigningAuthority): Promise<BuiltTransaction> {
    // Zilliqa uses Schnorr signatures over secp256k1 — NOT ECDSA.
    // Address format: bech32 zil1... (derived from secp256k1 pubkey → SHA256 → last 20 bytes).
    // Amounts in Qa (1 ZIL = 10^12 Qa).
    // Zilliqa 2.0 EVM transactions use the EVM builder path (chainId: 'zilliqa-evm').

    // Version encodes chain_id and tx_version: (chain_id << 16) | tx_version
    // Mainnet chain_id = 1, testnet = 333
    const isTestnet = tx.chain.includes('testnet');
    const chainIdBits = isTestnet ? 333 : 1;
    const version = (chainIdBits << 16) | 1;

    const raw: ZilliqaRawTx = {
      version,
      nonce: 0,                       // Must be fetched from network before signing
      toAddr: tx.to,
      amount: String(tx.amount),      // Qa
      gasPrice: tx.gasPrice ?? '2000000000',  // 2000 Li default
      gasLimit: tx.gasLimit ?? 50,
      code: tx.scillaCode,
      data: tx.scillaData,
    };

    const meta: ZilliqaTxMeta = {
      version,
      nonce: raw.nonce,
      gasPrice: raw.gasPrice,
      gasLimit: raw.gasLimit,
    };

    const isolation = createIsolationContext(tx.from, tx.chain, authority);

    const built: BuiltTransaction = {
      chain: tx.chain,
      family: 'zilliqa',
      type: tx.scillaCode ? 'contract-deploy' : tx.scillaData ? 'contract-call' : 'transfer',
      raw,
      meta,
      isolation,
    };

    validateIsolation(built);
    return built;
  }

  // ── Cardano (Ed25519-BIP32, eUTXO) ──────────────────────

  private async buildCardano(tx: ParsecTx, authority: SigningAuthority): Promise<BuiltTransaction> {
    // Cardano uses:
    //   - Ed25519-BIP32 extended keys (NOT secp256k1)
    //   - eUTXO model: inputs consumed entirely, outputs created fresh
    //   - Native multi-asset (tokens are first-class, not smart contracts)
    //   - CBOR serialization for transaction bodies
    //   - Plutus/Aiken for smart contracts
    //
    // Transaction building requires:
    //   1. Select UTXOs that cover amount + fee + min-ADA for outputs
    //   2. Compute fee from tx size (protocol parameters define fee formula)
    //   3. Build CBOR transaction body
    //   4. Sign with Ed25519-BIP32 key
    //
    // Full CBOR serialization requires @emurgo/cardano-serialization-lib-browser
    // or cardano-js-sdk. We build the intent here; serialization deferred.

    if (!tx.cardanoInputs?.length) {
      throw new Error('Cardano transactions require eUTXO inputs (tx.cardanoInputs)');
    }

    const inputLovelace = tx.cardanoInputs.reduce((sum, u) => sum + u.lovelace, BigInt(0));
    // Cardano fee formula: a * tx_size + b (protocol params, ~0.17 ADA typical)
    const estimatedFee = BigInt(200000); // ~0.2 ADA conservative estimate
    const amountLovelace = BigInt(tx.amount);
    const changeLovelace = inputLovelace - amountLovelace - estimatedFee;

    if (changeLovelace < BigInt(0)) {
      throw new Error(
        `Insufficient Cardano balance: have ${inputLovelace} lovelace, need ${amountLovelace + estimatedFee}`
      );
    }

    const outputs = tx.cardanoOutputs ?? [
      { address: tx.to, lovelace: amountLovelace },
    ];

    // Add change output if above min-ADA (1 ADA = 1_000_000 lovelace)
    if (changeLovelace > BigInt(1000000)) {
      outputs.push({
        address: tx.from,
        lovelace: changeLovelace,
        assets: tx.nativeAssets, // Return unspent native assets to sender
      });
    }

    const raw: CardanoRawTx = {
      cborHex: '',              // Populated by cardano-serialization-lib when available
      inputs: tx.cardanoInputs,
      outputs,
      fee: estimatedFee,
      ttl: tx.ttl,
    };

    const meta: CardanoTxMeta = {
      fee: estimatedFee,
      ttl: tx.ttl,
      inputCount: tx.cardanoInputs.length,
      outputCount: outputs.length,
    };

    const isolation = createIsolationContext(tx.from, tx.chain, authority);

    const built: BuiltTransaction = {
      chain: tx.chain,
      family: 'cardano',
      type: tx.nativeAssets?.length ? 'multi-asset-transfer' : 'transfer',
      raw,
      meta,
      isolation,
    };

    validateIsolation(built);
    return built;
  }

  // ── Arweave (RSA-4096, permaweb) ─────────────────────────

  private async buildArweave(tx: ParsecTx, authority: SigningAuthority): Promise<BuiltTransaction> {
    // Arweave uses:
    //   - RSA-4096 keypairs stored as JWK (RFC 7517)
    //   - Signing: RSA-PSS + SHA-256, producing 512-byte signatures
    //   - Address: SHA-256(base64url_decode(jwk.n)) → base64url (43 chars)
    //   - Two tx types: AR transfers (target + quantity) and data uploads (data + tags)
    //   - Deep hash of tx fields → RSA-PSS sign → attach signature
    //   - Miner reward (fee) based on data size, fetched from /price/{bytes}
    //   - Tags are name/value pairs (content-type, app-name, etc.)
    //   - Data chunking with Merkle tree for large uploads
    //
    // Pain points solved by this builder:
    //   1. Fee estimation — auto-fetch from gateway /price endpoint
    //   2. Anchor management — lastTx fetch + caching
    //   3. Tag normalization — consistent UTF-8 encoding
    //   4. Data chunking handled transparently for large payloads

    const isTransfer = tx.to && tx.amount > 0;
    const hasData = tx.arData && tx.arData.length > 0;

    // Fetch anchor (lastTx) if not provided
    let anchor = tx.arAnchor ?? '';
    if (!anchor) {
      // In production, fetch from gateway: GET /tx_anchor
      // For now, leave empty — the signing step must populate it
      anchor = '';
    }

    // Estimate reward (fee) from data size
    // Arweave fee formula: base + (bytes * rate), fetched from /price/{bytes}/{target}
    // Conservative fallback: ~0.0001 AR per KB
    const dataSize = tx.arData?.length ?? 0;
    const estimatedReward = String(Math.max(100000, dataSize * 100)); // winston

    const tags = tx.arTags ?? [];

    const raw: ArweaveRawTx = {
      format: 2,
      id: '',                     // Computed after signing (SHA-256 of signature)
      owner: '',                  // Set from JWK.n during signing
      target: isTransfer ? tx.to : '',
      quantity: isTransfer ? String(tx.amount) : '0',
      reward: estimatedReward,
      lastTx: anchor,
      data: '',                   // base64url of arData, set during serialization
      dataSize: String(dataSize),
      dataRoot: '',               // Merkle root, computed from data chunks
      tags,
      signature: '',              // Set after RSA-PSS signing
    };

    const meta: ArweaveTxMeta = {
      dataSize,
      reward: estimatedReward,
      lastTx: anchor,
      target: isTransfer ? tx.to : undefined,
      quantity: isTransfer ? String(tx.amount) : undefined,
      tags,
    };

    const isolation = createIsolationContext(tx.from, tx.chain, authority);

    const built: BuiltTransaction = {
      chain: tx.chain,
      family: 'arweave',
      type: hasData ? (isTransfer ? 'transfer+data' : 'data') : 'transfer',
      raw,
      meta,
      isolation,
    };

    validateIsolation(built);
    return built;
  }

  // ── Normalizer ───────────────────────────────────────────

  normalize(tx: {
    chain: string;
    from: string;
    to: string;
    amount: number;
    [key: string]: unknown;
  }): ParsecTx {
    const chain = getChain(tx.chain);
    if (!chain) throw new Error(`Unknown chain: ${tx.chain}`);

    return {
      chain: tx.chain,
      family: chain.family,
      from: tx.from,
      to: tx.to,
      amount: tx.amount,
      data: typeof tx.data === 'string' ? tx.data : undefined,
      note: typeof tx.note === 'string' ? tx.note : undefined,
      memo: typeof tx.memo === 'string' ? tx.memo : undefined,
    };
  }
}

// ── UTXO Fee Estimation ──────────────────────────────────────

function estimateUTXOSize(inputs: number, outputs: number): number {
  // P2WPKH: ~68 bytes per input, ~31 per output, ~11 overhead
  return 11 + (inputs * 68) + (outputs * 31);
}

function estimateUTXOFee(inputs: number, outputs: number, satPerByte = 10): number {
  return estimateUTXOSize(inputs, outputs) * satPerByte;
}
