// SpinTrade — Swap History
// Persists swap records to localStorage. Read-only display, no sensitive data.

export interface SwapRecord {
  id: string;
  timestamp: number;
  inputAssetId: number;
  inputSymbol: string;
  inputAmount: number;
  outputAssetId: number;
  outputSymbol: string;
  outputAmount: number;
  txId: string;
  dex: string;
  isMultiHop: boolean;
  hops: number;
  network: string;
}

const STORAGE_KEY = 'parsec-swap-history';
const MAX_RECORDS = 100;

export function getSwapHistory(): SwapRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SwapRecord[];
  } catch {
    return [];
  }
}

export function addSwapRecord(record: Omit<SwapRecord, 'id' | 'timestamp'>): void {
  const history = getSwapHistory();
  history.unshift({
    ...record,
    id: `swap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
  });
  // Keep last N records
  if (history.length > MAX_RECORDS) history.length = MAX_RECORDS;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function clearSwapHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function formatSwapDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
