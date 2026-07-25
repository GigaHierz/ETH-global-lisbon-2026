// Deterministic text similarity for audit replays: Jaccard over adjacent
// word bigrams. Good enough to separate "same model, temp 0" (high overlap)
// from "different model" (different phrasing) without an embedding dependency.
//
// Normalization is deliberately locked: NFKC, lowercase, punctuation and
// symbols to spaces, whitespace collapsed — and diacritics PRESERVED, so
// "café" and "cafe" stay distinct tokens.

export const DEFAULT_SIMILARITY_THRESHOLD = 0.35;

export type SimilarityVerdict = "passed" | "divergent" | "inconclusive";

const PUNCTUATION_AND_SYMBOLS = /[\p{P}\p{S}]/gu;
const REPEATED_WHITESPACE = /\s+/g;

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(PUNCTUATION_AND_SYMBOLS, " ")
    .replace(REPEATED_WHITESPACE, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized === "" ? [] : normalized.split(" ");
}

export function createWordBigrams(tokens: string[]): Set<string> {
  const bigrams = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return bigrams;
}

// Returns null rather than 0 when either side has no bigrams at all: an empty
// or one-word response carries no evidence either way, so callers must treat
// it as inconclusive rather than as maximal divergence.
export function jaccardSimilarity(left: Set<string>, right: Set<string>): number | null {
  if (left.size === 0 || right.size === 0) {
    return null;
  }

  let intersectionSize = 0;
  for (const bigram of left) {
    if (right.has(bigram)) {
      intersectionSize++;
    }
  }

  const unionSize = left.size + right.size - intersectionSize;
  return intersectionSize / unionSize;
}

export function classifySimilarity(similarity: number | null, threshold: number): SimilarityVerdict {
  if (similarity === null) {
    return "inconclusive";
  }
  return similarity >= threshold ? "passed" : "divergent";
}
