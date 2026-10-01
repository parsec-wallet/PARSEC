// Parsec dApp-side provider for @txnlab/use-wallet
//
// Drop this file into a dApp that already uses @txnlab/use-wallet and register
// Parsec as a WalletId.CUSTOM wallet. No protocol rebuild — use-wallet handles
// the UI and state; this file speaks JSON-RPC 2.0 over the Parsec Connect
// WebSocket (ws://127.0.0.1:9876/parsec/v1/connect/ws by default).
//
// Usage:
//   import { WalletManager, WalletId, NetworkId } from '@txnlab/use-wallet'
//   import { parsecProvider } from './parsec-use-wallet-provider'
//
//   const manager = new WalletManager({
//     wallets: [{
//       id: WalletId.CUSTOM,
//       options: { provider: parsecProvider() },
//       metadata: { name: 'Parsec', icon: '/icons/parsec.svg' },
//     }],
//     defaultNetwork: NetworkId.MAINNET,
//   })

import type algosdk from 'algosdk'
import type { CustomProvider } from '@txnlab/use-wallet'

export interface ParsecProviderOptions {
  /** Parsec Connect WebSocket URL. Defaults to ws://127.0.0.1:9876/parsec/v1/connect/ws. */
  url?: string
  /** Origin passed with sign requests so the user sees which dApp is asking. Defaults to window.location.origin. */
  origin?: string
  /** Optional human-readable message shown in the Parsec approval dialog. */
  defaultMessage?: string
  /** Timeout for a single JSON-RPC request, in ms. Parsec's own signing timeout is 120s. */
  requestTimeoutMs?: number
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: { code: number; message: string }
}

interface ParsecAccount {
  address: string
  label?: string
  network?: string
}

export function parsecProvider(options: ParsecProviderOptions = {}): CustomProvider {
  const url = options.url ?? 'ws://127.0.0.1:9876/parsec/v1/connect/ws'
  const origin = options.origin ?? (typeof window !== 'undefined' ? window.location.origin : 'unknown')
  const defaultMessage = options.defaultMessage ?? 'dApp requests transaction signing.'
  const requestTimeoutMs = options.requestTimeoutMs ?? 130_000

  let socket: WebSocket | null = null
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  async function ensureSocket(): Promise<WebSocket> {
    if (socket && socket.readyState === WebSocket.OPEN) return socket
    if (socket && socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((ok, err) => {
        socket!.addEventListener('open', () => ok(), { once: true })
        socket!.addEventListener('error', () => err(new Error('Parsec: WebSocket failed')), { once: true })
      })
      return socket!
    }
    socket = new WebSocket(url)
    socket.addEventListener('message', (ev) => {
      let msg: JsonRpcResponse
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') } catch { return }
      const waiter = pending.get(msg.id)
      if (!waiter) return
      pending.delete(msg.id)
      if (msg.error) waiter.reject(new Error(`Parsec [${msg.error.code}]: ${msg.error.message}`))
      else waiter.resolve(msg.result)
    })
    socket.addEventListener('close', () => {
      pending.forEach((p) => p.reject(new Error('Parsec: WebSocket closed')))
      pending.clear()
      socket = null
    })
    await new Promise<void>((ok, err) => {
      socket!.addEventListener('open', () => ok(), { once: true })
      socket!.addEventListener('error', () => err(new Error('Parsec: could not reach wallet')), { once: true })
    })
    return socket
  }

  async function call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const ws = await ensureSocket()
    const id = nextId++
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`Parsec: request timed out (${method})`))
      }, requestTimeoutMs)
      pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      ws.send(JSON.stringify(req))
    })
  }

  async function fetchAccounts() {
    const result = await call<{ accounts: ParsecAccount[] }>('parsec_accounts')
    if (!result?.accounts?.length) throw new Error('Parsec: no active account')
    return result.accounts.map((a) => ({ name: a.label ?? 'Parsec', address: a.address }))
  }

  function toBase64(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return btoa(s)
  }

  function fromBase64(b64: string): Uint8Array {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }

  function flattenTxns(
    group: algosdk.Transaction[] | Uint8Array[] | (algosdk.Transaction[] | Uint8Array[])[],
  ): (algosdk.Transaction | Uint8Array)[] {
    const arr = group as unknown[]
    if (arr.length === 0) return []
    if (Array.isArray(arr[0])) return (arr as unknown[][]).flat() as (algosdk.Transaction | Uint8Array)[]
    return arr as (algosdk.Transaction | Uint8Array)[]
  }

  function encodeTxn(t: algosdk.Transaction | Uint8Array): Uint8Array {
    if (t instanceof Uint8Array) return t
    if (typeof (t as algosdk.Transaction).toByte === 'function') return (t as algosdk.Transaction).toByte()
    throw new Error('Parsec: unsupported transaction type in group')
  }

  return {
    connect: fetchAccounts,

    disconnect: async () => {
      if (socket && socket.readyState === WebSocket.OPEN) socket.close()
      socket = null
      pending.forEach((p) => p.reject(new Error('Parsec: disconnected')))
      pending.clear()
    },

    resumeSession: fetchAccounts,

    signTransactions: async <T extends algosdk.Transaction[] | Uint8Array[]>(
      txnGroup: T | T[],
      indexesToSign?: number[],
    ) => {
      const flat = flattenTxns(txnGroup as algosdk.Transaction[] | Uint8Array[] | (algosdk.Transaction[] | Uint8Array[])[])
      const txns = flat.map((t) => toBase64(encodeTxn(t)))
      const result = await call<{ signedTxns: string[] }>('parsec_signTransactions', {
        txns,
        origin,
        message: defaultMessage,
      })
      const signed = result.signedTxns.map((s) => (s ? fromBase64(s) : null))
      if (!indexesToSign) return signed
      return flat.map((_, i) => (indexesToSign.includes(i) ? signed[i] ?? null : null))
    },
  }
}
