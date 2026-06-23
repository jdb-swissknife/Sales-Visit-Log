/**
 * Business name matching. Pure functions, no I/O.
 *
 * Given a transcript and a list of known businesses, try to identify which
 * business the rep was visiting. Uses Levenshtein fuzzy match on business
 * names mentioned in the transcript.
 */

/** Levenshtein distance (bounded at maxDist for early exit). */
export function levenshtein(a: string, b: string, maxDist = Infinity): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  let prevArr = new Array<number>(lb + 1);
  let currArr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prevArr[j] = j;

  for (let i = 1; i <= la; i++) {
    currArr[0] = i;
    let bestInRow = currArr[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      currArr[j] = Math.min(prevArr[j] + 1, currArr[j - 1] + 1, prevArr[j - 1] + cost);
      bestInRow = Math.min(bestInRow, currArr[j]);
    }
    if (bestInRow > maxDist) return maxDist + 1;
    [prevArr, currArr] = [currArr, prevArr];
  }
  return prevArr[lb];
}

export interface BusinessMatchResult {
  businessId: number;
  name: string;
  confidence: number; // 0..1
}

/**
 * Find which business from the list is mentioned in the transcript.
 * Strategy:
 * 1. Exact case-insensitive substring match of each business name in the transcript.
 * 2. If no exact match, try token-level fuzzy match (Levenshtein <= 2).
 * Returns the best match above the confidence threshold, or null.
 */
export function matchBusiness(
  transcript: string,
  businesses: Array<{ id: number; name: string }>,
  minConfidence = 0.6,
): BusinessMatchResult | null {
  if (!transcript || businesses.length === 0) return null;
  const lower = transcript.toLowerCase();

  let best: BusinessMatchResult | null = null;

  for (const biz of businesses) {
    const bizLower = biz.name.toLowerCase();
    // Exact substring match = high confidence
    if (bizLower.length >= 3 && lower.includes(bizLower)) {
      const confidence = Math.min(1, 0.5 + bizLower.length / 20);
      if (!best || confidence > best.confidence) {
        best = { businessId: biz.id, name: biz.name, confidence };
      }
      continue;
    }

    // Token-level fuzzy: scan transcript words for near-matches
    const words = lower.split(/\s+/);
    const bizTokens = bizLower.split(/\s+/).filter((w) => w.length >= 4);
    let matchedTokens = 0;
    for (const token of bizTokens) {
      for (const word of words) {
        const dist = levenshtein(token, word, 2);
        if (dist <= 2 && dist / Math.max(token.length, word.length) <= 0.3) {
          matchedTokens++;
          break;
        }
      }
    }
    if (bizTokens.length > 0 && matchedTokens > 0) {
      const confidence = matchedTokens / bizTokens.length;
      if (confidence >= minConfidence && (!best || confidence > best.confidence)) {
        best = { businessId: biz.id, name: biz.name, confidence };
      }
    }
  }

  return best;
}
