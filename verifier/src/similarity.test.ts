import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  classifySimilarity,
  createWordBigrams,
  jaccardSimilarity,
  normalizeText,
  tokenize,
} from "./similarity.js";

function bigramsOf(text: string): Set<string> {
  return createWordBigrams(tokenize(text));
}

describe("normalizeText", () => {
  it("applies NFKC normalization (fullwidth forms collapse to standard Latin)", () => {
    expect(normalizeText("Ｈｅｌｌｏ")).toBe("hello");
  });

  it("lowercases", () => {
    expect(normalizeText("Hello World")).toBe("hello world");
  });

  it("replaces Unicode punctuation and symbols with spaces", () => {
    expect(normalizeText("Hello, World! $5 <=> 10%")).toBe("hello world 5 10");
  });

  it("collapses repeated whitespace and trims", () => {
    expect(normalizeText("  Hello    World  \n\t ")).toBe("hello world");
  });

  it("preserves diacritics instead of folding them away", () => {
    expect(normalizeText("CAFÉ")).toBe("café");
    expect(normalizeText("café")).not.toBe(normalizeText("cafe"));
  });
});

describe("tokenize", () => {
  it("splits normalized text into whitespace-delimited tokens", () => {
    expect(tokenize("The Quick, Brown Fox!")).toEqual(["the", "quick", "brown", "fox"]);
  });

  it("returns an empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("returns an empty array when input is punctuation-only", () => {
    expect(tokenize("!!! ,,, ???")).toEqual([]);
  });

  it("returns a single token for one-word input", () => {
    expect(tokenize("hello")).toEqual(["hello"]);
  });
});

describe("createWordBigrams", () => {
  it("builds adjacent word bigrams", () => {
    expect(createWordBigrams(["the", "quick", "brown", "fox"])).toEqual(
      new Set(["the quick", "quick brown", "brown fox"]),
    );
  });

  it("returns an empty set for zero or one tokens", () => {
    expect(createWordBigrams([]).size).toBe(0);
    expect(createWordBigrams(["hello"]).size).toBe(0);
  });

  it("counts repeated bigrams once", () => {
    const tokens = tokenize("the cat sat on the mat and the cat sat again");
    const bigrams = createWordBigrams(tokens);
    // 10 adjacent pairs total, but "the cat" and "cat sat" each repeat once.
    expect(tokens.length).toBe(11);
    expect(bigrams.size).toBe(8);
    expect(bigrams.has("the cat")).toBe(true);
    expect(bigrams.has("cat sat")).toBe(true);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical text", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    expect(jaccardSimilarity(bigramsOf(text), bigramsOf(text))).toBe(1);
  });

  it("is unaffected by case differences", () => {
    const a = bigramsOf("The Quick Brown Fox");
    const b = bigramsOf("the quick brown fox");
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("is unaffected by punctuation differences", () => {
    const a = bigramsOf("Hello, World! Nice to meet you.");
    const b = bigramsOf("Hello World Nice to meet you");
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("is unaffected by whitespace differences", () => {
    const a = bigramsOf("Hello    World   Nice   Day");
    const b = bigramsOf("Hello World Nice Day");
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("scores partial overlap strictly between 0 and 1", () => {
    const a = bigramsOf("the quick brown fox jumps over the lazy dog");
    const b = bigramsOf("the quick brown fox leaps over a sleepy dog");
    const score = jaccardSimilarity(a, b);
    expect(score).toBeCloseTo(3 / 13);
    expect(score).not.toBeNull();
    expect(score as number).toBeGreaterThan(0);
    expect(score as number).toBeLessThan(1);
  });

  it("returns 0 for fully disjoint responses", () => {
    const a = bigramsOf("sunny beaches and warm weather");
    const b = bigramsOf("quantum computing requires stable qubits");
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("is unaffected by internal phrase repetition (set semantics)", () => {
    const a = bigramsOf("the cat sat on the mat and the cat sat again");
    const b = bigramsOf("the cat sat on the mat and the cat sat again");
    expect(jaccardSimilarity(a, b)).toBe(1);
  });

  it("returns null when either bigram set is empty", () => {
    const empty = bigramsOf("");
    const oneWord = bigramsOf("hello");
    const nonEmpty = bigramsOf("hello there world");
    expect(jaccardSimilarity(empty, empty)).toBeNull();
    expect(jaccardSimilarity(oneWord, nonEmpty)).toBeNull();
    expect(jaccardSimilarity(nonEmpty, empty)).toBeNull();
  });

  it("preserves diacritics when scoring similarity", () => {
    const accented = bigramsOf("café latte please");
    const unaccented = bigramsOf("cafe latte please");
    const score = jaccardSimilarity(accented, unaccented);
    // "café latte" and "cafe latte" are distinct bigrams; only "latte please" is shared.
    expect(score).toBeCloseTo(1 / 3);
  });

  it("is symmetric", () => {
    const a = bigramsOf("the quick brown fox jumps over the lazy dog");
    const b = bigramsOf("the quick brown fox leaps over a sleepy dog");
    expect(jaccardSimilarity(a, b)).toBe(jaccardSimilarity(b, a));
  });

  it("is always bounded between 0 and 1 inclusive", () => {
    const pairs: [string, string][] = [
      ["the quick brown fox", "the quick brown fox"],
      ["sunny beaches and warm weather", "quantum computing requires stable qubits"],
      ["the quick brown fox jumps over the lazy dog", "the quick brown fox leaps over a sleepy dog"],
      ["café latte please", "cafe latte please"],
      ["a b c d e f g h i j", "b c d e f g h i j k"],
    ];

    for (const [left, right] of pairs) {
      const score = jaccardSimilarity(bigramsOf(left), bigramsOf(right));
      if (score !== null) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("classifySimilarity", () => {
  it("defaults the threshold to 0.35", () => {
    expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.35);
  });

  it("is inconclusive when similarity is null", () => {
    expect(classifySimilarity(null, DEFAULT_SIMILARITY_THRESHOLD)).toBe("inconclusive");
  });

  it("passes when the score is exactly at the threshold boundary", () => {
    const threshold = DEFAULT_SIMILARITY_THRESHOLD;
    expect(classifySimilarity(threshold, threshold)).toBe("passed");
  });

  it("diverges when the score is immediately below the threshold", () => {
    const threshold = DEFAULT_SIMILARITY_THRESHOLD;
    expect(classifySimilarity(threshold - Number.EPSILON, threshold)).toBe("divergent");
  });

  it("passes when score is above threshold and diverges when below", () => {
    expect(classifySimilarity(0.9, DEFAULT_SIMILARITY_THRESHOLD)).toBe("passed");
    expect(classifySimilarity(0.1, DEFAULT_SIMILARITY_THRESHOLD)).toBe("divergent");
  });
});
