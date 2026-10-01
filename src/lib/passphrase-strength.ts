// PARSEC Wallet — passphrase strength assessment.
//
// An estimate of how many guesses an attacker who has the vault file would need,
// expressed in bits, from what the passphrase is made of — not only its length.
// It looks for the shapes people actually use: common passwords, words, years,
// keyboard runs (qwerty), sequences (abcd, 1234), repeats (aaaa), and a capital
// at the front with a digit at the end. A passphrase of several random words is
// recognised as such and credited per word.
//
// It is guidance, not a gate: the vault's own rule (Rust, `vault_create`) is a
// minimum of 8 characters. No dependency, no network; the passphrase never
// leaves this function.

export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface StrengthAssessment {
  level: StrengthLevel;
  /** Very weak · Weak · Fair · Strong · Very strong */
  label: string;
  /** Estimated entropy in bits (rounded). */
  bits: number;
  /** What would most improve it; empty when nothing needs saying. */
  hint: string;
  /** Specific weaknesses found, for display. */
  warnings: string[];
}

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;

// The most common passwords and wallet-flavoured words; a passphrase that is
// one of these (ignoring case, digits and symbols around it) is guessed first.
const COMMON = new Set([
  'password', 'passw0rd', 'passphrase', '123456', '12345678', '123456789', 'qwerty', 'qwertyuiop',
  'letmein', 'welcome', 'admin', 'administrator', 'iloveyou', 'monkey', 'dragon', 'master', 'sunshine',
  'princess', 'football', 'baseball', 'shadow', 'superman', 'trustno1', 'abc123', 'login', 'secret',
  'changeme', 'default', 'hello', 'freedom', 'whatever', 'qazwsx', 'starwars', 'computer', 'michael',
  'parsec', 'bankon', 'algorand', 'bitcoin', 'ethereum', 'solana', 'crypto', 'wallet', 'satoshi',
  'nakamoto', 'blockchain', 'hodl', 'moon', 'lambo', 'mnemonic', 'seed', 'vault',
]);

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'qazwsxedc'];

/** Undo the common look-alike swaps (0→o, 1→l, 3→e, 4/@→a, 5/$→s). */
function deleet(s: string): string {
  return s.replace(/0/g, 'o').replace(/1/g, 'l').replace(/3/g, 'e').replace(/[4@]/g, 'a').replace(/[5$]/g, 's');
}

function poolSize(s: string): number {
  let pool = 0;
  if (/[a-z]/.test(s)) pool += 26;
  if (/[A-Z]/.test(s)) pool += 26;
  if (/[0-9]/.test(s)) pool += 10;
  if (/[^a-zA-Z0-9\s]/.test(s)) pool += 33;
  if (/\s/.test(s)) pool += 1;
  if (/[^\u0000-\u007f]/.test(s)) pool += 100;
  return Math.max(pool, 1);
}

/** Length of the longest run that walks forward or backward one step at a time (abcd, 4321). */
function longestSequence(s: string): number {
  let best = 1, run = 1, dir = 0;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if ((d === 1 || d === -1) && (run === 1 || d === dir)) { run++; dir = d; }
    else { run = 1; dir = 0; }
    best = Math.max(best, run);
  }
  return s.length ? best : 0;
}

function longestRepeat(s: string): number {
  let best = 0, run = 0;
  for (let i = 0; i < s.length; i++) {
    run = i > 0 && s[i] === s[i - 1] ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

function keyboardRun(lower: string): number {
  let best = 0;
  for (const row of KEYBOARD_ROWS) {
    for (let len = row.length; len >= 4; len--) {
      for (let i = 0; i + len <= row.length; i++) {
        const piece = row.slice(i, i + len);
        if (lower.includes(piece) || lower.includes([...piece].reverse().join(''))) { best = Math.max(best, len); break; }
      }
      if (best >= len) break;
    }
  }
  return best;
}

/** Split into words when it looks like a multi-word passphrase (spaces, dashes, dots, underscores). */
function words(s: string): string[] {
  return s.split(/[\s\-_.]+/).filter((w) => w.length > 0);
}

export function assessPassphrase(passphrase: string): StrengthAssessment {
  const chars = [...passphrase];
  const n = chars.length;
  if (n === 0) return { level: 0, label: LABELS[0], bits: 0, hint: '', warnings: [] };

  const lower = passphrase.toLowerCase();
  const core = lower.replace(/[^a-z]/g, '');
  const warnings: string[] = [];

  // 1. A common password, possibly decorated (Password1!, 2024bitcoin, p4ssw0rd123).
  const trimmed = lower.replace(/^[^a-z]+|[^a-z]+$/g, '');
  const candidates = [lower, trimmed, deleet(trimmed), deleet(lower).replace(/^[^a-z]+|[^a-z]+$/g, '')];
  if (candidates.some((c) => COMMON.has(c)) || (core.length >= 4 && COMMON.has(core) && passphrase.length - core.length <= 4)) {
    warnings.push('This is one of the first passphrases an attacker tries.');
    return finish(Math.min(10, n * 1.5), warnings, n);
  }

  // 2. Several words: credit each word, not each letter.
  const ws = words(passphrase);
  const multiWord = ws.length >= 3 && ws.every((w) => w.length >= 3);
  // Capitalised words run together (MyDogSpot2019) are words too.
  const camel = passphrase.match(/[A-Z][a-z]+/g) ?? [];
  const camelWords = !multiWord && camel.length >= 2 && camel.join('').length >= n * 0.6;
  let bits: number;
  if (multiWord) {
    // ~11 bits per word, as if drawn from a 2,048-word list; a little more for
    // long or mixed words, less for repeated ones.
    const unique = new Set(ws.map((w) => w.toLowerCase())).size;
    bits = unique * 11 + (ws.length - unique) * 2;
    if (/[A-Z]/.test(passphrase) && /[a-z]/.test(passphrase)) bits += 2;
    if (/\d/.test(passphrase)) bits += 3;
    if (unique < ws.length) warnings.push('A repeated word adds almost nothing.');
  } else if (camelWords) {
    const rest = passphrase.replace(/[A-Z][a-z]+/g, '');
    bits = camel.length * 11 + (rest.match(/\d/g)?.length ?? 0) * 2 + (rest.match(/[^a-zA-Z0-9]/g)?.length ?? 0) * 4;
    if (/(19|20)\d\d/.test(rest)) warnings.push('Years and dates are easy to guess.');
  } else {
    bits = n * Math.log2(poolSize(passphrase));

    // 3. Patterns that shrink the real search space.
    const rep = longestRepeat(passphrase);
    if (rep >= 3) { bits -= (rep - 1) * Math.log2(poolSize(passphrase)); warnings.push('Repeated characters (aaa) are easy to guess.'); }
    const seq = longestSequence(lower);
    if (seq >= 4) { bits -= (seq - 2) * 3; warnings.push('Sequences like abcd or 1234 are easy to guess.'); }
    const kb = keyboardRun(lower);
    if (kb >= 4) { bits -= (kb - 2) * 3; warnings.push('Keyboard runs like qwerty are easy to guess.'); }
    if (/(19|20)\d\d/.test(passphrase)) { bits -= 8; warnings.push('Years and dates are easy to guess.'); }
    if (/^[A-Z][a-z]+\d{1,4}[^a-zA-Z0-9]?$/.test(passphrase)) { bits -= 16; warnings.push('A capital first and a number last is the most common pattern.'); }
    // Letters with look-alike swaps inside a word (Tr0ub4dor): undo the swaps,
    // and if a word-like run of letters appears, the swaps are in every cracking list.
    const unleet = deleet(lower);
    const run = unleet.match(/[a-z]{5,}/g)?.find((r) => (r.match(/[aeiouy]/g)?.length ?? 0) >= r.length * 0.3);
    if (run && /[013456@$]/.test(passphrase) && !lower.includes(run)) {
      bits -= 14; warnings.push('Swapping letters for look-alikes (0 for o, 4 for a) is well known.');
    }
    if (/^\d+$/.test(passphrase)) { bits = Math.min(bits, n * 3.32); warnings.push('Digits alone are quick to search.'); }
    for (const w of COMMON) {
      if (w.length >= 5 && lower.includes(w)) { bits -= w.length * 2; warnings.push(`Contains “${w}”, a common word.`); break; }
    }
  }

  return finish(Math.max(bits, 0), warnings, n, multiWord);
}

function finish(rawBits: number, warnings: string[], n: number, multiWord = false): StrengthAssessment {
  const bits = Math.round(rawBits);
  const level: StrengthLevel = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  let hint = '';
  if (n < 8) hint = 'The vault needs at least 8 characters.';
  else if (level <= 1) hint = 'Use four or more unrelated words, or press Generate.';
  else if (level === 2) hint = multiWord ? 'Add another unrelated word.' : 'Longer is stronger: add a few unrelated words.';
  return { level, label: LABELS[level], bits, hint, warnings };
}
