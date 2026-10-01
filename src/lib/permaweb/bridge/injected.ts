// Burn via an injected EIP-1193 wallet (MetaMask / Coinbase / Rabby). Lifted from the old
// ario-migrate-solana view: connect → ensure Base → eth_sendTransaction with the burn calldata.
// The browser wallet signs; parsec never sees that key. Vault-custodied signing lives in vault-evm.ts.

import { detectInjectedProvider } from '../../builder/isolation';
import { BASE_ARIO, BASE_CHAIN_ID_HEX } from '../constants';
import { encodeBurnCalldata, formatDestination } from './abi';

export type ProviderRequest = (args: { method: string; params?: unknown[] }) => Promise<unknown>;

export function injectedRequest(): ProviderRequest | null {
  const p = detectInjectedProvider();
  return p ? (p.request.bind(p) as ProviderRequest) : null;
}

/** Connect and switch to Base. Returns the selected account. */
export async function connectInjectedOnBase(request: ProviderRequest): Promise<string> {
  const accounts = (await request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts?.length) throw new Error('No EVM account approved');
  const chainId = (await request({ method: 'eth_chainId' })) as string;
  if (chainId.toLowerCase() !== BASE_CHAIN_ID_HEX) {
    try {
      await request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_CHAIN_ID_HEX }] });
    } catch {
      throw new Error('Base network switch declined — switch to Base in the wallet and retry.');
    }
  }
  return accounts[0];
}

/** Submit `burn(amount, "solana:<dest>")` through the injected wallet. Resolves to the tx hash. */
export async function burnViaInjected(
  request: ProviderRequest,
  o: { from: string; amountRaw: bigint; solanaDestination: string },
): Promise<string> {
  const data = encodeBurnCalldata(o.amountRaw, formatDestination(o.solanaDestination));
  const hash = (await request({
    method: 'eth_sendTransaction',
    params: [{ from: o.from, to: BASE_ARIO, data, value: '0x0' }],
  })) as string;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`unexpected tx hash: ${hash}`);
  return hash;
}
