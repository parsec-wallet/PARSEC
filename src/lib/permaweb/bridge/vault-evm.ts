// Burn via the vault-custodied EVM key: assemble the EIP-1559 fields from Base RPC, sign in Rust,
// broadcast. Same calldata as the injected path.

import { BASE_ARIO, BASE_CHAIN_ID } from '../constants';
import { encodeBurnCalldata, formatDestination } from './abi';
import { getNonce, getFeeHints, estimateGas, sendRaw, readEthBalance } from './base-rpc';
import { signEvmTxInVault } from '../evm/vault-key';

export async function burnViaVault(o: { evmAddress: string; amountRaw: bigint; solanaDestination: string }): Promise<{ hash: string; gasLimit: bigint; maxFeePerGas: bigint }> {
  const data = encodeBurnCalldata(o.amountRaw, formatDestination(o.solanaDestination));
  const [nonce, fees, gasLimit, eth] = await Promise.all([
    getNonce(o.evmAddress), getFeeHints(), estimateGas({ from: o.evmAddress, to: BASE_ARIO, data }), readEthBalance(o.evmAddress),
  ]);
  const worstCase = gasLimit * fees.maxFeePerGas;
  if (eth < worstCase) throw new Error(`Insufficient ETH on Base for gas: need ≈ ${worstCase} wei, have ${eth}`);
  const signed = await signEvmTxInVault(o.evmAddress, {
    chain_id: BASE_CHAIN_ID, nonce,
    max_priority_fee_per_gas: fees.maxPriorityFeePerGas.toString(), max_fee_per_gas: fees.maxFeePerGas.toString(),
    gas_limit: Number(gasLimit), to: BASE_ARIO, value: '0', data,
  });
  const hash = await sendRaw(signed.raw_hex);
  return { hash, gasLimit, maxFeePerGas: fees.maxFeePerGas };
}
