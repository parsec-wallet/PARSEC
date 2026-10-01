import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DexModule, DexQuote, DexAsset } from '../types';

// --- Build mock DEX modules ---

function makeDexModule(id: string, overrides: Partial<DexModule> = {}): DexModule {
  return {
    id,
    name: id,
    enabled: true,
    fetchPairsForAsset: vi.fn().mockResolvedValue([]),
    getQuote: vi.fn().mockResolvedValue(null),
    executeSwap: vi.fn().mockResolvedValue({ txId: 'mock-tx' }),
    ...overrides,
  };
}

function makeQuote(overrides: Partial<DexQuote> = {}): DexQuote {
  return {
    inputAssetId: 0,
    outputAssetId: 31566704,
    inputAmount: 1000000,
    outputAmount: 250000,
    priceImpact: 0.001,
    exchangeRate: 0.25,
    fee: 3000,
    minOutput: 248750,
    poolAddress: 'POOL1',
    dex: 'tinyman-onchain',
    ...overrides,
  };
}

function makeAsset(overrides: Partial<DexAsset> = {}): DexAsset {
  return {
    assetId: 31566704,
    unitName: 'USDC',
    name: 'USDC',
    decimals: 6,
    ...overrides,
  };
}

// Mock the DEX module imports so spintrade.ts uses our controlled modules
const mockTinymanOnchain = makeDexModule('tinyman-onchain');
const mockTinymanApi = makeDexModule('tinyman-api');
const mockPact = makeDexModule('pact');

vi.mock('../tinyman-onchain', () => ({
  tinymanOnchainModule: mockTinymanOnchain,
}));
vi.mock('../tinyman-api', () => ({
  tinymanApiModule: mockTinymanApi,
}));
vi.mock('../pact', () => ({
  pactModule: mockPact,
}));

// Import after mocks are set up
const { fetchAllPairs, fetchAllQuotes, fetchBestQuote } = await import('../spintrade');

describe('SpinTrade DEX Aggregator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Re-enable all mocks and set default returns
    mockTinymanOnchain.enabled = true;
    mockTinymanApi.enabled = true;
    mockPact.enabled = true;
    (mockTinymanOnchain.fetchPairsForAsset as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (mockTinymanOnchain.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockTinymanOnchain.executeSwap as ReturnType<typeof vi.fn>).mockResolvedValue({ txId: 'mock-tx' });
    (mockTinymanApi.fetchPairsForAsset as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (mockTinymanApi.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockTinymanApi.executeSwap as ReturnType<typeof vi.fn>).mockResolvedValue({ txId: 'mock-tx' });
    (mockPact.fetchPairsForAsset as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (mockPact.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (mockPact.executeSwap as ReturnType<typeof vi.fn>).mockResolvedValue({ txId: 'mock-tx' });
  });

  describe('fetchAllPairs', () => {
    it('deduplicates assets by assetId across DEX sources', async () => {
      const usdc = makeAsset({ assetId: 31566704, unitName: 'USDC' });
      const usdt = makeAsset({ assetId: 312769, unitName: 'USDT' });
      const usdcDup = makeAsset({ assetId: 31566704, unitName: 'USDC' }); // same ID from different DEX

      (mockTinymanOnchain.fetchPairsForAsset as ReturnType<typeof vi.fn>).mockResolvedValue([usdc, usdt]);
      (mockTinymanApi.fetchPairsForAsset as ReturnType<typeof vi.fn>).mockResolvedValue([usdcDup]);
      (mockPact.fetchPairsForAsset as ReturnType<typeof vi.fn>).mockResolvedValue([usdt]);

      const pairs = await fetchAllPairs(0, 'mainnet');
      // USDC appears in tinyman-onchain and tinyman-api, USDT in tinyman-onchain and pact
      // After dedup: 2 unique assets
      expect(pairs).toHaveLength(2);
      const ids = pairs.map(p => p.assetId);
      expect(ids).toContain(31566704);
      expect(ids).toContain(312769);
    });
  });

  describe('fetchAllQuotes', () => {
    it('sorts by best output (highest outputAmount first)', async () => {
      const lowQuote = makeQuote({ outputAmount: 200000, dex: 'tinyman-onchain' });
      const highQuote = makeQuote({ outputAmount: 300000, dex: 'pact' });
      const midQuote = makeQuote({ outputAmount: 250000, dex: 'tinyman-api' });

      (mockTinymanOnchain.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(lowQuote);
      (mockTinymanApi.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(midQuote);
      (mockPact.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(highQuote);

      const quotes = await fetchAllQuotes(0, 31566704, 1000000, 50, 'mainnet');
      expect(quotes).toHaveLength(3);
      expect(quotes[0].outputAmount).toBe(300000);
      expect(quotes[1].outputAmount).toBe(250000);
      expect(quotes[2].outputAmount).toBe(200000);
    });
  });

  describe('fetchBestQuote', () => {
    it('returns direct quote when one side is ALGO', async () => {
      const quote = makeQuote({ inputAssetId: 0, outputAssetId: 31566704, outputAmount: 250000 });
      (mockTinymanOnchain.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(quote);

      const result = await fetchBestQuote(0, 31566704, 1000000, 50, 'mainnet');
      expect(result).not.toBeNull();
      expect(result!.isMultiHop).toBe(false);
      expect(result!.outputAmount).toBe(250000);
    });

    it('prefers direct over multi-hop when direct gives equal or better output', async () => {
      // Direct: ASA_A (10) → ASA_B (20) gives 500
      const directQuote = makeQuote({
        inputAssetId: 10, outputAssetId: 20, outputAmount: 500,
        dex: 'tinyman-onchain', fee: 1000, priceImpact: 0.01,
      });

      // Hop 1: ASA_A (10) → ALGO (0) gives 1000
      const hop1Quote = makeQuote({
        inputAssetId: 10, outputAssetId: 0, outputAmount: 1000,
        dex: 'tinyman-onchain', fee: 500, priceImpact: 0.005, poolAddress: 'POOL_A_ALGO',
      });

      // Hop 2: ALGO (0) → ASA_B (20) gives 500 (same as direct)
      const hop2Quote = makeQuote({
        inputAssetId: 0, outputAssetId: 20, outputAmount: 500,
        dex: 'pact', fee: 500, priceImpact: 0.005, poolAddress: 'POOL_ALGO_B',
      });

      (mockTinymanOnchain.getQuote as ReturnType<typeof vi.fn>).mockImplementation(
        async (inputId: number, outputId: number) => {
          if (inputId === 10 && outputId === 20) return directQuote;
          if (inputId === 10 && outputId === 0) return hop1Quote;
          if (inputId === 0 && outputId === 20) return null;
          return null;
        }
      );
      (mockTinymanApi.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockPact.getQuote as ReturnType<typeof vi.fn>).mockImplementation(
        async (inputId: number, outputId: number) => {
          if (inputId === 0 && outputId === 20) return hop2Quote;
          return null;
        }
      );

      const result = await fetchBestQuote(10, 20, 1000000, 50, 'mainnet');
      expect(result).not.toBeNull();
      // Direct wins because outputAmount >= multi-hop outputAmount
      expect(result!.isMultiHop).toBe(false);
      expect(result!.outputAmount).toBe(500);
    });

    it('returns multi-hop when no direct route exists', async () => {
      // No direct route for ASA_A (10) → ASA_B (20)
      // Hop 1: ASA_A → ALGO gives 1000
      const hop1 = makeQuote({
        inputAssetId: 10, outputAssetId: 0, outputAmount: 1000,
        dex: 'tinyman-onchain', fee: 500, priceImpact: 0.005, poolAddress: 'POOL_A',
      });
      // Hop 2: ALGO → ASA_B gives 450
      const hop2 = makeQuote({
        inputAssetId: 0, outputAssetId: 20, outputAmount: 450,
        dex: 'pact', fee: 500, priceImpact: 0.005, poolAddress: 'POOL_B',
      });

      (mockTinymanOnchain.getQuote as ReturnType<typeof vi.fn>).mockImplementation(
        async (inputId: number, outputId: number) => {
          if (inputId === 10 && outputId === 20) return null; // no direct
          if (inputId === 10 && outputId === 0) return hop1;
          if (inputId === 0 && outputId === 20) return null;
          return null;
        }
      );
      (mockTinymanApi.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockPact.getQuote as ReturnType<typeof vi.fn>).mockImplementation(
        async (inputId: number, outputId: number) => {
          if (inputId === 0 && outputId === 20) return hop2;
          return null;
        }
      );

      const result = await fetchBestQuote(10, 20, 1000000, 50, 'mainnet');
      expect(result).not.toBeNull();
      expect(result!.isMultiHop).toBe(true);
      expect(result!.hops).toHaveLength(2);
      expect(result!.outputAmount).toBe(450);
    });

    it('returns null when no quotes available', async () => {
      (mockTinymanOnchain.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockTinymanApi.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockPact.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const result = await fetchBestQuote(10, 20, 1000000, 50, 'mainnet');
      expect(result).toBeNull();
    });

    it('multi-hop compound slippage calculation is correct', async () => {
      const hop1 = makeQuote({
        inputAssetId: 10, outputAssetId: 0, outputAmount: 1000,
        dex: 'tinyman-onchain', fee: 100, priceImpact: 1, poolAddress: 'P1',
      });
      const hop2 = makeQuote({
        inputAssetId: 0, outputAssetId: 20, outputAmount: 800,
        dex: 'pact', fee: 80, priceImpact: 2, poolAddress: 'P2',
      });

      (mockTinymanOnchain.getQuote as ReturnType<typeof vi.fn>).mockImplementation(
        async (inputId: number, outputId: number) => {
          if (inputId === 10 && outputId === 20) return null;
          if (inputId === 10 && outputId === 0) return hop1;
          if (inputId === 0 && outputId === 20) return null;
          return null;
        }
      );
      (mockTinymanApi.getQuote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
      (mockPact.getQuote as ReturnType<typeof vi.fn>).mockImplementation(
        async (inputId: number, outputId: number) => {
          if (inputId === 0 && outputId === 20) return hop2;
          return null;
        }
      );

      const result = await fetchBestQuote(10, 20, 1000000, 50, 'mainnet');
      expect(result).not.toBeNull();
      expect(result!.isMultiHop).toBe(true);

      // Impacts are percent (every DEX module reports percent): 1 % then 2 % compound to
      // 100 × (1 − 0.99 × 0.98) = 2.98 %.
      expect(result!.priceImpact).toBeCloseTo(2.98, 4);

      // Total fee: 100 + 80 = 180
      expect(result!.fee).toBe(180);

      // Min output with slippage: floor(800 * (1 - 50/10000)) = floor(800 * 0.995) = floor(796) = 796
      expect(result!.minOutput).toBe(796);
    });
  });
});

describe('two-hop arithmetic', () => {
  it('compounds percent impacts as fractions', async () => {
    const { compoundImpactPct } = await import('../spintrade');
    expect(compoundImpactPct(3, 3)).toBeCloseTo(5.91, 2);
    expect(compoundImpactPct(0, 0)).toBe(0);
    expect(compoundImpactPct(3, 3)).toBeGreaterThan(5); // the >5 % warning now fires
  });

  it('scales hop 2 down to what hop 1 guaranteed, in integers', async () => {
    const { scaleFloor } = await import('../spintrade');
    expect(scaleFloor(990_000, 950_000, 1_000_000)).toBe(940_500);
    expect(scaleFloor(9_007_199_254_740_000, 3, 7)).toBe(3_860_228_252_031_428); // the product passes 2^53: exact in BigInt
  });
});
