// Deterministic choice of the next request to audit.
//
// Newest-first: the demo audits the request the operator just watched get routed.
// The scan does not stop at the newest candidate though — a request whose model
// has no second provider can never be compared, so it is passed over instead of
// blocking every older candidate behind it forever.
//
// Selection is a pure function of (request log, provider table, audited ids,
// slashed wallets), so the live loop stays a thin transport shell around it and
// the eligibility rules are testable without a network.

import type { ProviderRow, RequestLogEntry } from "@agentrouter/shared";

export interface AuditSelectionInput {
  requestLog: readonly RequestLogEntry[];
  providers: readonly ProviderRow[];
  /** Request ids this verifier has already audited. */
  auditedRequestIds: Iterable<string>;
  /** Payout accounts this verifier has already slashed — may lead /providers. */
  slashedWallets: Iterable<string>;
}

export type AuditSelection =
  | { outcome: "selected"; request: RequestLogEntry; accused: ProviderRow; witness: ProviderRow }
  | { outcome: "skipped"; reason: "no_eligible_request" }
  | { outcome: "skipped"; reason: "no_witness"; request: RequestLogEntry; accused: ProviderRow };

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  /* v8 ignore next -- providers are keyed by unique url, so the tie is unreachable in sorts */
  return 0;
}

export function selectAuditCandidate(input: AuditSelectionInput): AuditSelection {
  const audited = new Set(input.auditedRequestIds);
  const slashedWallets = new Set(input.slashedWallets);
  // The exchange keys its provider table by url, and every log entry carries the
  // url it was served by, so url is the exact identity of the accused.
  const providersByUrl = new Map(input.providers.map((p) => [p.url, p]));
  const isSlashed = (p: ProviderRow) => p.status === "slashed" || slashedWallets.has(p.wallet);

  const eligible = input.requestLog
    .filter((request) => request.status === "ok" && !request.isAudit && !audited.has(request.id))
    .map((request) => ({ request, accused: providersByUrl.get(request.providerUrl) }))
    .filter((pair): pair is { request: RequestLogEntry; accused: ProviderRow } => {
      const { request, accused } = pair;
      if (!accused || isSlashed(accused)) return false;
      // A down provider can only time out, and a provider that has since changed
      // its advertised model cannot be judged on this request's model — both
      // would burn the candidate on a guaranteed-inconclusive replay.
      return accused.status === "live" && accused.model === request.model;
    })
    .sort((a, b) => b.request.ts - a.request.ts || compareStrings(b.request.id, a.request.id));

  if (eligible.length === 0) return { outcome: "skipped", reason: "no_eligible_request" };

  let witnessless: { request: RequestLogEntry; accused: ProviderRow } | null = null;
  for (const { request, accused } of eligible) {
    const witness = input.providers
      .filter(
        (p) =>
          p.status === "live" &&
          !isSlashed(p) &&
          p.url !== accused.url &&
          // Same payout account = the accused wearing a second endpoint; it can
          // never testify against itself.
          p.wallet !== accused.wallet &&
          p.model === request.model,
      )
      .sort((a, b) => a.priceHbar - b.priceHbar || compareStrings(a.url, b.url))[0];

    if (witness) return { outcome: "selected", request, accused, witness };
    witnessless ??= { request, accused };
  }

  // eligible is non-empty and every entry failed to find a witness, so the
  // newest witness-less candidate was recorded above.
  return { outcome: "skipped", reason: "no_witness", ...witnessless! };
}
