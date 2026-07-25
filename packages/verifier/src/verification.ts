// Turns a pair of audit replays into a verdict.
//
// The hard rule: only two intact, comparable responses can ever produce
// "divergent". Every operational failure (timeout, network, HTTP, malformed
// body, empty body) and every response too short to yield a bigram is
// "inconclusive", so a flaky provider is never mistaken for a cheating one.

import { classifySimilarity, createWordBigrams, jaccardSimilarity, tokenize } from "./similarity.js";

export type ReplayOutcome =
  | { kind: "ok"; text: string }
  | { kind: "timeout" }
  | { kind: "network_error"; message: string }
  | { kind: "http_error"; status: number }
  | { kind: "malformed_response" }
  | { kind: "empty_response" };

export type VerificationVerdict = "passed" | "divergent" | "skipped" | "inconclusive";

export type VerificationReason =
  | "accused_timeout"
  | "accused_network_error"
  | "accused_http_error"
  | "accused_malformed_response"
  | "accused_empty_response"
  | "accused_insufficient_tokens"
  | "witness_timeout"
  | "witness_network_error"
  | "witness_http_error"
  | "witness_malformed_response"
  | "witness_empty_response"
  | "witness_insufficient_tokens";

export interface VerificationResult {
  verdict: VerificationVerdict;
  similarity: number | null;
  threshold: number;
  reason?: VerificationReason;
}

type Party = "accused" | "witness";
type FailedReplayOutcome = Exclude<ReplayOutcome, { kind: "ok" }>;

function failureReason(party: Party, outcome: FailedReplayOutcome): VerificationReason {
  switch (outcome.kind) {
    case "timeout":
      return party === "accused" ? "accused_timeout" : "witness_timeout";
    case "network_error":
      return party === "accused" ? "accused_network_error" : "witness_network_error";
    case "http_error":
      return party === "accused" ? "accused_http_error" : "witness_http_error";
    case "malformed_response":
      return party === "accused" ? "accused_malformed_response" : "witness_malformed_response";
    case "empty_response":
      return party === "accused" ? "accused_empty_response" : "witness_empty_response";
  }
}

function inconclusive(threshold: number, reason: VerificationReason): VerificationResult {
  return { verdict: "inconclusive", similarity: null, threshold, reason };
}

export function classifyReplayOutcomes(
  accused: ReplayOutcome,
  witness: ReplayOutcome,
  threshold: number,
): VerificationResult {
  if (accused.kind !== "ok") {
    return inconclusive(threshold, failureReason("accused", accused));
  }
  if (witness.kind !== "ok") {
    return inconclusive(threshold, failureReason("witness", witness));
  }

  const accusedTokens = tokenize(accused.text);
  if (accusedTokens.length < 2) {
    return inconclusive(threshold, "accused_insufficient_tokens");
  }

  const witnessTokens = tokenize(witness.text);
  if (witnessTokens.length < 2) {
    return inconclusive(threshold, "witness_insufficient_tokens");
  }

  const similarity = jaccardSimilarity(createWordBigrams(accusedTokens), createWordBigrams(witnessTokens));

  // Both sides have >= 2 tokens here, so both bigram sets are non-empty and
  // the score is never null — classifySimilarity yields passed or divergent.
  return { verdict: classifySimilarity(similarity, threshold), similarity, threshold };
}

// The single gate in front of stake movement: nothing but a divergent verdict
// enforces, and a payout account already slashed is never slashed twice (audit
// ticks can overlap the exchange's provider-table refresh).
export function shouldEnforceSlash(
  result: VerificationResult,
  accusedWallet: string,
  alreadySlashedWallets: ReadonlySet<string>,
): boolean {
  return result.verdict === "divergent" && !alreadySlashedWallets.has(accusedWallet);
}
