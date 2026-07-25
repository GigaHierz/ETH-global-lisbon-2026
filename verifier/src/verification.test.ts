import { describe, expect, it } from "vitest";
import { DEFAULT_SIMILARITY_THRESHOLD } from "./similarity.js";
import { classifyReplayOutcomes, type ReplayOutcome } from "./verification.js";

const VALID: ReplayOutcome = { kind: "ok", text: "a b c d e f" };

describe("classifyReplayOutcomes: operational failures (never divergent)", () => {
  it("accused timeout -> inconclusive / accused_timeout", () => {
    const result = classifyReplayOutcomes({ kind: "timeout" }, VALID, DEFAULT_SIMILARITY_THRESHOLD);
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "accused_timeout",
    });
  });

  it("witness timeout -> inconclusive / witness_timeout", () => {
    const result = classifyReplayOutcomes(VALID, { kind: "timeout" }, DEFAULT_SIMILARITY_THRESHOLD);
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "witness_timeout",
    });
  });

  it("accused network error -> inconclusive / accused_network_error", () => {
    const result = classifyReplayOutcomes(
      { kind: "network_error", message: "ECONNRESET" },
      VALID,
      DEFAULT_SIMILARITY_THRESHOLD,
    );
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "accused_network_error",
    });
  });

  it("witness network error -> inconclusive / witness_network_error", () => {
    const result = classifyReplayOutcomes(
      VALID,
      { kind: "network_error", message: "ECONNRESET" },
      DEFAULT_SIMILARITY_THRESHOLD,
    );
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "witness_network_error",
    });
  });

  it("accused http error -> inconclusive / accused_http_error", () => {
    const result = classifyReplayOutcomes({ kind: "http_error", status: 500 }, VALID, DEFAULT_SIMILARITY_THRESHOLD);
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "accused_http_error",
    });
  });

  it("witness http error -> inconclusive / witness_http_error", () => {
    const result = classifyReplayOutcomes(VALID, { kind: "http_error", status: 503 }, DEFAULT_SIMILARITY_THRESHOLD);
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "witness_http_error",
    });
  });

  it("accused malformed response -> inconclusive / accused_malformed_response", () => {
    const result = classifyReplayOutcomes({ kind: "malformed_response" }, VALID, DEFAULT_SIMILARITY_THRESHOLD);
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "accused_malformed_response",
    });
  });

  it("witness malformed response -> inconclusive / witness_malformed_response", () => {
    const result = classifyReplayOutcomes(VALID, { kind: "malformed_response" }, DEFAULT_SIMILARITY_THRESHOLD);
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "witness_malformed_response",
    });
  });

  it("accused empty response -> inconclusive / accused_empty_response", () => {
    const result = classifyReplayOutcomes({ kind: "empty_response" }, VALID, DEFAULT_SIMILARITY_THRESHOLD);
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "accused_empty_response",
    });
  });

  it("witness empty response -> inconclusive / witness_empty_response", () => {
    const result = classifyReplayOutcomes(VALID, { kind: "empty_response" }, DEFAULT_SIMILARITY_THRESHOLD);
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "witness_empty_response",
    });
  });

  // The locked guarantee, asserted directly: no operational failure and no
  // degenerate response on either side may ever be reported as divergent.
  it("no failure or degenerate outcome on either side is ever divergent", () => {
    const failures: ReplayOutcome[] = [
      { kind: "timeout" },
      { kind: "network_error", message: "ECONNRESET" },
      { kind: "http_error", status: 500 },
      { kind: "malformed_response" },
      { kind: "empty_response" },
      { kind: "ok", text: "" },
      { kind: "ok", text: "   " },
      { kind: "ok", text: "!!! ,,, ???" },
      { kind: "ok", text: "hello" },
    ];

    for (const failure of failures) {
      for (const [accused, witness] of [
        [failure, VALID],
        [VALID, failure],
      ] as const) {
        const result = classifyReplayOutcomes(accused, witness, DEFAULT_SIMILARITY_THRESHOLD);
        expect(result.verdict).toBe("inconclusive");
        expect(result.similarity).toBeNull();
        expect(result.reason).toBeDefined();
      }
    }
  });
});

describe("classifyReplayOutcomes: two valid responses", () => {
  it("passes for honest, matching responses", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    const result = classifyReplayOutcomes({ kind: "ok", text }, { kind: "ok", text }, DEFAULT_SIMILARITY_THRESHOLD);
    expect(result).toEqual({
      verdict: "passed",
      similarity: 1,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
    });
  });

  it("passes for partially matching responses above threshold", () => {
    const result = classifyReplayOutcomes(
      { kind: "ok", text: "a b c d" },
      { kind: "ok", text: "a b c e" },
      DEFAULT_SIMILARITY_THRESHOLD,
    );
    expect(result).toEqual({
      verdict: "passed",
      similarity: 0.5,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
    });
  });

  it("is divergent for responses with no meaningful overlap", () => {
    const result = classifyReplayOutcomes(
      { kind: "ok", text: "sunny beaches and warm weather" },
      { kind: "ok", text: "quantum computing requires stable qubits" },
      DEFAULT_SIMILARITY_THRESHOLD,
    );
    expect(result).toEqual({
      verdict: "divergent",
      similarity: 0,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
    });
  });

  it("passes when similarity lands exactly on the threshold", () => {
    const result = classifyReplayOutcomes({ kind: "ok", text: "a b c d" }, { kind: "ok", text: "a b c e" }, 0.5);
    expect(result).toEqual({ verdict: "passed", similarity: 0.5, threshold: 0.5 });
  });

  it("is inconclusive when the accused side has fewer than two usable tokens", () => {
    const result = classifyReplayOutcomes(
      { kind: "ok", text: "hello" },
      { kind: "ok", text: "a b c d e" },
      DEFAULT_SIMILARITY_THRESHOLD,
    );
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "accused_insufficient_tokens",
    });
  });

  it("is inconclusive when the witness side has fewer than two usable tokens", () => {
    const result = classifyReplayOutcomes(
      { kind: "ok", text: "a b c d e" },
      { kind: "ok", text: "hello" },
      DEFAULT_SIMILARITY_THRESHOLD,
    );
    expect(result).toEqual({
      verdict: "inconclusive",
      similarity: null,
      threshold: DEFAULT_SIMILARITY_THRESHOLD,
      reason: "witness_insufficient_tokens",
    });
  });

  it("is inconclusive when an ok response is an empty string (degenerate, not empty_response)", () => {
    const result = classifyReplayOutcomes(
      { kind: "ok", text: "" },
      { kind: "ok", text: "a b c d e" },
      DEFAULT_SIMILARITY_THRESHOLD,
    );
    expect(result.verdict).toBe("inconclusive");
    expect(result.reason).toBe("accused_insufficient_tokens");
  });

  it("checks the accused side first when both sides are degenerate", () => {
    const result = classifyReplayOutcomes(
      { kind: "ok", text: "hi" },
      { kind: "ok", text: "bye" },
      DEFAULT_SIMILARITY_THRESHOLD,
    );
    expect(result.reason).toBe("accused_insufficient_tokens");
  });

  it("is symmetric: swapping accused and witness yields the same verdict and similarity", () => {
    const forward = classifyReplayOutcomes(
      { kind: "ok", text: "a b c d" },
      { kind: "ok", text: "a b c e" },
      DEFAULT_SIMILARITY_THRESHOLD,
    );
    const backward = classifyReplayOutcomes(
      { kind: "ok", text: "a b c e" },
      { kind: "ok", text: "a b c d" },
      DEFAULT_SIMILARITY_THRESHOLD,
    );
    expect(forward).toEqual(backward);
  });
});
