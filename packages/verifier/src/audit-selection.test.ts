import { describe, expect, it } from "vitest";
import type { ProviderRow, RequestLogEntry } from "@agentrouter/shared";
import { selectAuditCandidate, type AuditSelectionInput } from "./audit-selection.js";

const MODEL = "llama-3.3-70b-versatile";

function provider(overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    displayName: "Titan Compute",
    model: MODEL,
    price: 0.1,
    wallet: "0.0.1001",
    agentId: null,
    url: "http://localhost:4021",
    status: "live",
    reputation: 100,
    stakeHbar: 50,
    requestsServed: 0,
    ...overrides,
  };
}

function request(served: ProviderRow, overrides: Partial<RequestLogEntry> = {}): RequestLogEntry {
  return {
    id: "req-1",
    ts: 1_000,
    model: served.model,
    provider: served.displayName,
    providerUrl: served.url,
    price: served.price,
    fee: 0,
    total: served.price,
    latencyMs: 120,
    paymentRef: "mock-ref",
    promptPreview: "what is the capital of portugal?",
    answerPreview: "Lisbon.",
    status: "ok",
    ...overrides,
  };
}

const ACCUSED = provider({ displayName: "SketchyGPU Labs", wallet: "0.0.1003", url: "http://localhost:4023", price: 0.08 });
const WITNESS = provider();

function select(overrides: Partial<AuditSelectionInput> = {}) {
  return selectAuditCandidate({
    requestLog: [],
    providers: [ACCUSED, WITNESS],
    auditedRequestIds: [],
    slashedWallets: [],
    ...overrides,
  });
}

describe("selectAuditCandidate: which request", () => {
  it("picks the newest eligible request", () => {
    const older = request(ACCUSED, { id: "req-old", ts: 1_000 });
    const newest = request(ACCUSED, { id: "req-new", ts: 3_000 });
    const middle = request(ACCUSED, { id: "req-mid", ts: 2_000 });

    const result = select({ requestLog: [older, newest, middle] });

    expect(result.outcome).toBe("selected");
    expect(result.outcome === "selected" && result.request.id).toBe("req-new");
  });

  it("breaks ts ties deterministically, whatever order the log arrives in", () => {
    const a = request(ACCUSED, { id: "req-a", ts: 5_000 });
    const b = request(ACCUSED, { id: "req-b", ts: 5_000 });

    const forward = select({ requestLog: [a, b] });
    const reversed = select({ requestLog: [b, a] });

    expect(forward).toEqual(reversed);
    expect(forward.outcome === "selected" && forward.request.id).toBe("req-b");
  });

  it("skips a request that was already audited", () => {
    const audited = request(ACCUSED, { id: "req-audited", ts: 3_000 });
    const fresh = request(ACCUSED, { id: "req-fresh", ts: 2_000 });

    const result = select({ requestLog: [audited, fresh], auditedRequestIds: ["req-audited"] });

    expect(result.outcome === "selected" && result.request.id).toBe("req-fresh");
  });

  it("skips a replay the verifier generated itself", () => {
    const replay = request(ACCUSED, { id: "req-replay", ts: 3_000, isAudit: true });
    const organic = request(ACCUSED, { id: "req-organic", ts: 2_000 });

    const result = select({ requestLog: [replay, organic] });

    expect(result.outcome === "selected" && result.request.id).toBe("req-organic");
  });

  it("skips a request served by a provider the exchange already marked slashed", () => {
    const slashed = provider({ displayName: "SketchyGPU Labs", wallet: "0.0.1003", url: "http://localhost:4023", status: "slashed" });
    const stale = request(slashed, { id: "req-slashed", ts: 3_000 });
    const other = request(WITNESS, { id: "req-other", ts: 2_000 });
    const third = provider({ displayName: "Third", wallet: "0.0.1004", url: "http://localhost:4024" });

    const result = select({ requestLog: [stale, other], providers: [slashed, WITNESS, third] });

    expect(result.outcome === "selected" && result.request.id).toBe("req-other");
  });

  it("skips a request served by a wallet this verifier slashed before /providers caught up", () => {
    const stale = request(ACCUSED, { id: "req-slashed", ts: 3_000 });
    const other = request(WITNESS, { id: "req-other", ts: 2_000 });
    const third = provider({ displayName: "Third", wallet: "0.0.1004", url: "http://localhost:4024" });

    const result = select({
      requestLog: [stale, other],
      providers: [ACCUSED, WITNESS, third],
      slashedWallets: [ACCUSED.wallet],
    });

    expect(result.outcome === "selected" && result.request.id).toBe("req-other");
  });

  it("skips failed requests and requests from unknown or down providers", () => {
    const failed = request(ACCUSED, { id: "req-failed", ts: 5_000, status: "error" });
    const unknown = request(provider({ url: "http://localhost:4099", wallet: "0.0.9999" }), { id: "req-unknown", ts: 4_000 });
    const down = provider({ displayName: "Napping Co", wallet: "0.0.1005", url: "http://localhost:4025", status: "down" });
    const offline = request(down, { id: "req-down", ts: 3_000 });
    const good = request(ACCUSED, { id: "req-good", ts: 1_000 });

    const result = select({ requestLog: [failed, unknown, offline, good], providers: [ACCUSED, WITNESS, down] });

    expect(result.outcome === "selected" && result.request.id).toBe("req-good");
  });

  it("skips a request whose provider now advertises a different model", () => {
    const rebranded = request(ACCUSED, { id: "req-stale-model", ts: 3_000, model: "llama-3.1-8b-instant" });
    const current = request(ACCUSED, { id: "req-current", ts: 2_000 });

    const result = select({ requestLog: [rebranded, current] });

    expect(result.outcome === "selected" && result.request.id).toBe("req-current");
  });

  it("reports no_eligible_request when nothing is auditable", () => {
    expect(select({ requestLog: [] })).toEqual({ outcome: "skipped", reason: "no_eligible_request" });
  });
});

describe("selectAuditCandidate: who is accused", () => {
  it("accuses the provider that served the request, by url, not by display name", () => {
    const impostor = provider({ displayName: "SketchyGPU Labs", wallet: "0.0.2003", url: "http://localhost:4033" });
    const entry = request(ACCUSED, { id: "req-1", ts: 1_000 });

    const result = select({ requestLog: [entry], providers: [impostor, ACCUSED, WITNESS] });

    expect(result.outcome === "selected" && result.accused.url).toBe(ACCUSED.url);
    expect(result.outcome === "selected" && result.accused.wallet).toBe(ACCUSED.wallet);
  });
});

describe("selectAuditCandidate: who witnesses", () => {
  const entry = request(ACCUSED, { id: "req-1", ts: 1_000 });

  it("requires a witness advertising the exact same model", () => {
    const nearMiss = provider({ displayName: "Almost", wallet: "0.0.1006", url: "http://localhost:4026", model: "llama-3.3-70b" });

    const result = select({ requestLog: [entry], providers: [ACCUSED, nearMiss] });

    expect(result).toEqual({ outcome: "skipped", reason: "no_witness", request: entry, accused: ACCUSED });
  });

  it("never accepts a down, slashed or self-witnessing provider", () => {
    const down = provider({ displayName: "Napping Co", wallet: "0.0.1005", url: "http://localhost:4025", status: "down" });
    const slashed = provider({ displayName: "Burned Co", wallet: "0.0.1007", url: "http://localhost:4027", status: "slashed" });
    const sameWallet = provider({ displayName: "SketchyGPU Labs (alt)", wallet: ACCUSED.wallet, url: "http://localhost:4028" });

    const result = select({ requestLog: [entry], providers: [ACCUSED, down, slashed, sameWallet] });

    expect(result.outcome).toBe("skipped");
    expect(result.outcome === "skipped" && result.reason).toBe("no_witness");
  });

  it("never accepts a witness this verifier slashed before /providers caught up", () => {
    const result = select({ requestLog: [entry], slashedWallets: [WITNESS.wallet] });

    expect(result.outcome === "skipped" && result.reason).toBe("no_witness");
  });

  it("picks the cheapest eligible witness, breaking ties on url", () => {
    const pricey = provider({ displayName: "Pricey", wallet: "0.0.1008", url: "http://localhost:4029", price: 0.5 });
    const cheapA = provider({ displayName: "Cheap A", wallet: "0.0.1009", url: "http://localhost:4030", price: 0.02 });
    const cheapB = provider({ displayName: "Cheap B", wallet: "0.0.1010", url: "http://localhost:4020", price: 0.02 });

    const result = select({ requestLog: [entry], providers: [ACCUSED, pricey, cheapA, cheapB] });

    expect(result.outcome === "selected" && result.witness.url).toBe(cheapB.url);
  });

  it("passes over a witness-less newest request instead of blocking older auditable ones", () => {
    const lonely = provider({ displayName: "Solo Model Co", wallet: "0.0.1011", url: "http://localhost:4031", model: "llama-3.1-8b-instant" });
    const newestUnwitnessable = request(lonely, { id: "req-lonely", ts: 9_000 });
    const auditable = request(ACCUSED, { id: "req-auditable", ts: 1_000 });

    const result = select({ requestLog: [newestUnwitnessable, auditable], providers: [ACCUSED, WITNESS, lonely] });

    expect(result.outcome === "selected" && result.request.id).toBe("req-auditable");
    expect(result.outcome === "selected" && result.witness.url).toBe(WITNESS.url);
  });

  it("reports the newest witness-less candidate when no candidate can be witnessed", () => {
    const lonely = provider({ displayName: "Solo Model Co", wallet: "0.0.1011", url: "http://localhost:4031", model: "llama-3.1-8b-instant" });
    const newest = request(lonely, { id: "req-newest", ts: 9_000 });
    const older = request(lonely, { id: "req-older", ts: 1_000 });

    const result = select({ requestLog: [older, newest], providers: [lonely] });

    expect(result).toEqual({ outcome: "skipped", reason: "no_witness", request: newest, accused: lonely });
  });
});
