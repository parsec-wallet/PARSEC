import { describe, it, expect } from 'vitest';
import { inferChainFromAddress, mergeRecovered } from '../recovery';
import type { RecoveredKey } from '../recovery';
import type { WalletAccount } from '../../types/wallet';

const ALGO = 'MFRGGZDFMZTWQ2LKNNWG23TPOBYXE43UOJUW4ZLTMFRGGZDFMZTWQ2LKNN';   // Algorand addresses are exactly 58 chars
const SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const AR = 'a1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
const EVM = '0x79B5B6F47F865194EAa02756883a003f06F7Ba6c';
const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';

function key(address: string, chain: string, chainKnown = true): RecoveredKey {
  return { address, chain, label: 'Account', chainKnown } as RecoveredKey;
}

describe('inferChainFromAddress', () => {
  it('recognises each chain by shape', () => {
    expect(inferChainFromAddress(EVM)).toBe('ethereum');
    expect(inferChainFromAddress(BTC)).toBe('bitcoin');
    expect(inferChainFromAddress(ALGO)).toBe('algorand');
    expect(inferChainFromAddress(SOL)).toBe('solana');
  });

  it('uses base58-illegal characters to separate Arweave from Solana', () => {
    // '-' and '_' cannot appear in base58, so they settle the 43-char overlap.
    expect(inferChainFromAddress(AR)).toBe('arweave');
  });

  it('refuses to guess at something it cannot place', () => {
    expect(inferChainFromAddress('')).toBe('unknown');
    expect(inferChainFromAddress('not an address')).toBe('unknown');
    expect(inferChainFromAddress('0xdeadbeef')).toBe('unknown');
  });

  it('tolerates surrounding whitespace', () => {
    expect(inferChainFromAddress(`  ${EVM}  `)).toBe('ethereum');
  });
});

describe('mergeRecovered', () => {
  it('reopens a wallet whose account list was lost', () => {
    const { accounts, added } = mergeRecovered([], [key(ALGO, 'algorand')]);
    expect(added).toBe(1);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].address).toBe(ALGO);
    expect(accounts[0].chains?.algorand).toBe(ALGO);
  });

  it('attaches non-Algorand keys to the identity rather than making new ones', () => {
    const { accounts, added, attached } = mergeRecovered(
      [],
      [key(ALGO, 'algorand'), key(SOL, 'solana'), key(AR, 'arweave')],
    );
    expect(added).toBe(1);
    expect(attached).toBe(2);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].chains).toMatchObject({ algorand: ALGO, solana: SOL, arweave: AR });
  });

  it('never duplicates an account it already knows', () => {
    const existing: WalletAccount[] = [
      { address: ALGO, name: 'Mine', createdAt: 1, chains: { algorand: ALGO } },
    ];
    const { accounts, added } = mergeRecovered(existing, [key(ALGO, 'algorand')]);
    expect(added).toBe(0);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].name).toBe('Mine');   // the user's own naming survives
  });

  it('does not mutate the accounts it was given', () => {
    const existing: WalletAccount[] = [
      { address: ALGO, name: 'Mine', createdAt: 1, chains: { algorand: ALGO } },
    ];
    const snapshot = JSON.stringify(existing);
    mergeRecovered(existing, [key(SOL, 'solana')]);
    expect(JSON.stringify(existing)).toBe(snapshot);
  });

  it('reports nothing to do when the keystore agrees with the store', () => {
    const existing: WalletAccount[] = [
      { address: ALGO, name: 'Mine', createdAt: 1, chains: { algorand: ALGO, solana: SOL } },
    ];
    const { added, attached } = mergeRecovered(existing, [key(ALGO, 'algorand'), key(SOL, 'solana')]);
    expect(added).toBe(0);
    expect(attached).toBe(0);
  });

  it('drops orphan chain keys when there is no identity to hang them on', () => {
    // A Solana key with no Algorand account must not invent one.
    const { accounts, added, attached } = mergeRecovered([], [key(SOL, 'solana')]);
    expect(added).toBe(0);
    expect(attached).toBe(0);
    expect(accounts).toHaveLength(0);
  });

  it('recovers several identities at once', () => {
    const second = 'NBSWY3DPFQQHO33SNRSCCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const { accounts, added } = mergeRecovered([], [key(ALGO, 'algorand'), key(second, 'algorand')]);
    expect(added).toBe(2);
    expect(accounts.map((a) => a.address)).toEqual([ALGO, second]);
  });
});
