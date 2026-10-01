// PARSEC Wallet — Fuzzy Matching
//
// Subsequence scoring for the command palette. Kept free of any DOM reference
// so the algorithm is unit-testable on its own.

export interface FuzzyMatch {
  score: number;
  /** Indices in the target that matched, for highlighting. */
  hits: number[];
}

/**
 * Score `query` against `target` as a subsequence match, rewarding contiguous
 * runs and word-start hits. Returns null when `query` is not a subsequence of
 * `target` at all.
 */
export function fuzzy(query: string, target: string): FuzzyMatch | null {
  if (!query) return { score: 0, hits: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const hits: number[] = [];
  let score = 0;
  let ti = 0;
  let streak = 0;

  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    while (ti < t.length) {
      if (t[ti] === ch) { found = ti; break; }
      ti++;
    }
    if (found === -1) return null;

    hits.push(found);
    // Contiguous runs are far more meaningful than scattered letters.
    streak = hits.length > 1 && hits[hits.length - 2] === found - 1 ? streak + 1 : 0;
    score += 1 + streak * 3;
    // Matching the start of a word is a strong signal.
    if (found === 0 || /[\s\-_/.]/.test(t[found - 1])) score += 6;
    ti++;
  }

  // Prefer shorter targets: a full match on "Send" beats one inside a long title.
  score += Math.max(0, 12 - target.length / 2);
  return { score, hits };
}
