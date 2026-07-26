import express from "express";
import cors from "cors";
import {
  log,
  MOCK_MODE,
  AUDIT_REQUEST_HEADER,
  PROMPT_PREVIEW_LIMIT,
  MOCK_PAYMENT_HEADER,
  EXCHANGE_FEE_BPS,
  HEDERA_NETWORK,
  ASSET_LABEL,
  ASSET_SYMBOL,
  SETTLEMENT_ASSET,
  SCHEME_CONFIG,
  money,
  baseUnitsOf,
  fromBaseUnits,
  settlementPriceFromUnits,
  resolveFacilitator,
  hederaAccount,
  publishToTopic,
  topicLinks,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
} from "@agentrouter/shared";
import {
  providers,
  providerList,
  requestLog,
  priceIndex,
  verifyLog,
  addSSEClient,
  broadcast,
  pushRequest,
  pushVerify,
  mockLedger,
  revenue,
  statsSnapshot,
} from "./state.js";
import { startDiscovery, pickProvider, refreshProviders } from "./discovery.js";
import { hydrateFromTrades } from "./hydrate.js";
import { initPayer, paidPost } from "./payer.js";
import { applySlash } from "./slash.js";
import { applyBondEvent } from "./bond.js";
import { quoteFor, pinnedQuote, quoteById, consumeQuote, type Quote } from "./quotes.js";
import { sendRefund, REFUND_ON_FAILURE } from "./refund.js";

// Hosts (Railway/Render/Fly) inject PORT; fall back to EXCHANGE_PORT locally.
const PORT = parseInt(process.env.PORT || process.env.EXCHANGE_PORT || "4100", 10);
// Percentage taker fee: the agent pays provider price + fee (EXCHANGE_FEE_BPS,
// ceil-rounded in the settlement asset's base units so the exchange never
// underquotes). Providers always receive exactly their listed price; the fee is
// the exchange's revenue.
const exchangeWallet = MOCK_MODE ? "0.0.mock-exchange" : hederaAccount("EXCHANGE").id;

// quoteId → request-log entry id awaiting its inbound (agent→exchange) settle tx
const pendingSettles = new Map<string, string>();

function routeQuote(body: ChatCompletionRequest): Quote | null {
  return quoteFor(body, pickProvider(body.model), EXCHANGE_FEE_BPS);
}

await initPayer();
startDiscovery();

// Rebuild the settlement feed from the trades topic before serving. Without this a
// redeploy shows an empty dashboard and zeroed revenue, even though every trade is
// still on-chain — the container's uptime, not the ledger, decided what you saw.
hydrateFromTrades()
  .then((n) => n > 0 && log("exchange", `rehydrated ${n} trades from the HCS trades topic`))
  .catch(() => {});

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, mock: MOCK_MODE, settlement: SETTLEMENT_ASSET }));

// What every price on this exchange is denominated in. The dashboard reads this to
// label its axes; it defaults to USDC on its own side if the exchange is unreachable.
app.get("/settlement", (_req, res) =>
  res.json({ asset: SETTLEMENT_ASSET, label: ASSET_LABEL, symbol: ASSET_SYMBOL }),
);

app.get("/providers", (_req, res) => res.json(providerList()));

// Cumulative revenue: { totalVolumeHbar, requests, feeRevenueHbar, refunds, refundFailures, feeBps }
app.get("/stats", (_req, res) => res.json(statsSnapshot()));

// HCS audit-trail topic ids + Hashscan links (dashboard reads Mirror Node itself)
app.get("/topics", (_req, res) => res.json({ mock: MOCK_MODE, topics: topicLinks() }));

app.get("/log", (req, res) => {
  const limit = parseInt(String(req.query.limit || "100"), 10);
  res.json(requestLog.slice(-limit));
});

app.get("/price-index", (_req, res) => res.json(priceIndex.slice(-500)));

// Verifier audit history (oldest→newest). Lets the dashboard backfill its
// audit log on load instead of waiting for the next live `verify` SSE event.
app.get("/verifies", (req, res) => {
  const limit = parseInt(String(req.query.limit || "10"), 10);
  res.json(verifyLog.slice(-limit));
});

app.get("/events", (req, res) => {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "providers", providers: providerList() })}\n\n`);
  const remove = addSSEClient((chunk) => res.write(chunk));
  req.on("close", remove);
});

// Verifier calls this to take a provider out of rotation after a slash.
app.post("/slash", (req, res) => {
  const result = applySlash(providerList(), req.body ?? {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  const { row } = result;
  const { amountHbar, reason } = req.body as { amountHbar: number; reason: string };
  providers.set(row.url, row);
  log("exchange", `SLASHED ${row.displayName}: -${amountHbar} ℏ stake. Reason: ${reason}`);
  broadcast({ type: "slashed", provider: row.displayName, amountHbar, reason });
  broadcast({ type: "providers", providers: providerList() });
  res.json({ ok: true });
});

// Verifier reports each HTS ReputationBond transition (frozen → wiped) so the
// dashboard's Bond column animates alongside the SLASHED banner.
app.post("/bond-event", (req, res) => {
  const result = applyBondEvent(providerList(), req.body ?? {});
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  const { row } = result;
  const { freezeTx, scheduleId, wipeTx } = req.body as {
    freezeTx?: string | null; scheduleId?: string | null; wipeTx?: string | null;
  };
  providers.set(row.url, row);
  log("exchange", `BOND ${row.displayName}: ${row.bondStatus} (${row.bondTokens} ARBOND)`);
  broadcast({
    type: "bond", provider: row.displayName, wallet: row.wallet,
    bondTokens: row.bondTokens, bondStatus: row.bondStatus, freezeTx, scheduleId, wipeTx,
  });
  broadcast({ type: "providers", providers: providerList() });
  res.json({ ok: true });
});

// Verifier reports each comparison so the dashboard can show verification activity.
app.post("/verify-report", (req, res) => {
  const { provider, witness, similarity, verdict } = req.body;
  pushVerify({ provider, witness, similarity, verdict });
  const row = providerList().find((p) => p.displayName === provider);
  if (row && verdict === "ok" && row.status === "live") {
    row.reputation = Math.min(100, row.reputation + 1);
    providers.set(row.url, row);
  }
  res.json({ ok: true });
});

// ---- payment gate: dynamic per-request 402 — total = provider price + fee ----
// The quote is created at 402 time and PINNED for 60s: the paid retry (same
// body) recomputes the identical pinned amount, so the agent's signed payment
// verifies even if provider prices changed in between.
if (MOCK_MODE) {
  app.use("/v1/chat/completions", (req, res, next) => {
    if (req.method !== "POST") return next();
    const body = req.body as ChatCompletionRequest;
    const quote = body?.model && body?.messages?.length ? routeQuote(body) : null;
    if (!quote) return next(); // router below answers 400/503 properly
    const paidUnits = baseUnitsOf(parseFloat(req.header(MOCK_PAYMENT_HEADER) ?? "0"));
    if (paidUnits >= quote.totalUnits) {
      // charge the mock ledger up-front (mirrors real settle; refunded on failure)
      mockLedger.set(exchangeWallet, (mockLedger.get(exchangeWallet) ?? 0) + fromBaseUnits(quote.totalUnits));
      return next();
    }
    return res.status(402).json({
      error: "Payment Required (mock)",
      accepts: [
        {
          scheme: "mock",
          price: `${fromBaseUnits(quote.totalUnits)} ${ASSET_LABEL}`,
          payTo: exchangeWallet,
          extra: {
            quoteId: quote.quoteId,
            price: fromBaseUnits(quote.priceUnits),
            fee: fromBaseUnits(quote.feeUnits),
            asset: ASSET_LABEL,
          },
        },
      ],
    });
  });
  log("exchange", `MOCK paywall: dynamic quote (fee ${EXCHANGE_FEE_BPS} bps, ${ASSET_LABEL}) via ${MOCK_PAYMENT_HEADER}`);
} else {
  const { paymentMiddleware, x402ResourceServer } = await import("@x402/express");
  const { ExactHederaScheme } = await import("@x402/hedera/exact/server");
  const { HTTPFacilitatorClient } = await import("@x402/core/server");
  const facilitatorUrl = await resolveFacilitator("exchange");
  const server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: facilitatorUrl }),
  ).register("hedera:*", new ExactHederaScheme(SCHEME_CONFIG));

  // After the facilitator settles the agent's payment (post-response), attach the
  // inbound tx to the trade, accrue fee revenue, and publish the HCS trade message.
  server.onAfterSettle(async (ctx) => {
    const quoteId = (ctx.requirements.extra as { quoteId?: string } | undefined)?.quoteId;
    if (!quoteId) return;
    const inboundRef = ctx.result.transaction;
    const entryId = pendingSettles.get(quoteId);
    pendingSettles.delete(quoteId);
    const entry = entryId ? requestLog.find((e) => e.id === entryId) : undefined;
    const quote = quoteById(quoteId);
    if (entry) {
      entry.inboundRef = inboundRef;
      broadcast({ type: "request", entry });
    }
    revenue.requests += 1;
    revenue.volumeUnits += entry ? baseUnitsOf(entry.price) : (quote?.priceUnits ?? 0);
    revenue.feeUnits += entry ? baseUnitsOf(entry.fee) : (quote?.feeUnits ?? 0);
    broadcast({ type: "stats", stats: statsSnapshot() });
    if (quote) consumeQuote(quote);
    log("exchange", `inbound settled ${inboundRef.slice(0, 24)}… (quote ${quoteId}) — fee revenue now ${money(statsSnapshot().feeRevenue.toFixed(4))}`);
    if (entry) {
      publishToTopic("trades", hederaAccount("EXCHANGE"), {
        type: "trade",
        model: entry.model,
        provider: entry.provider,
        providerAccount: providerList().find((pr) => pr.displayName === entry.provider)?.wallet ?? "?",
        price: entry.price,
        fee: entry.fee,
        total: entry.total,
        asset: ASSET_LABEL, // immutable log: the unit has to travel with the amounts
        latencyMs: entry.latencyMs,
        inboundTx: inboundRef,
        paymentTx: entry.paymentRef,
        ...(entry.servedBy ? { servedBy: entry.servedBy } : {}),
        ...(entry.upstreamModel ? { upstreamModel: entry.upstreamModel } : {}),
      }).catch((e) => log("exchange", `HCS trade publish failed: ${(e as Error).message.slice(0, 80)}`));
    }
  });
  server.onVerifiedPaymentCanceled(async (ctx) => {
    const quoteId = (ctx.requirements?.extra as { quoteId?: string } | undefined)?.quoteId;
    log("exchange", `agent payment CANCELED before settlement (quote ${quoteId ?? "?"}) — agent was never charged`);
  });
  server.onSettleFailure(async (ctx) => {
    const quoteId = (ctx.requirements?.extra as { quoteId?: string } | undefined)?.quoteId;
    revenue.refundFailures += 0; // settle failure = exchange unpaid, agent unharmed; logged only
    log("exchange", `🚨 inbound settlement FAILED after serving (quote ${quoteId ?? "?"}) — exchange absorbed the provider cost`);
  });

  app.use(
    paymentMiddleware(
      {
        "POST /v1/chat/completions": {
          accepts: [
            {
              scheme: "exact",
              network: HEDERA_NETWORK,
              payTo: exchangeWallet,
              // Dynamic per-request quote (routing-dependent), pinned for 60s.
              price: (ctx) => {
                const body = ctx.adapter.getBody?.() as ChatCompletionRequest | undefined;
                const quote = body?.model && body?.messages?.length ? routeQuote(body) : null;
                if (!quote) {
                  // No live provider: quote 0 so verification never passes a real charge;
                  // the router below answers 503 for unpaid + paid alike.
                  return settlementPriceFromUnits(0);
                }
                return {
                  ...settlementPriceFromUnits(quote.totalUnits),
                  extra: {
                    quoteId: quote.quoteId,
                    priceUnits: String(quote.priceUnits),
                    feeUnits: String(quote.feeUnits),
                    asset: ASSET_LABEL,
                  },
                };
              },
            },
          ],
          description: "AgentRouter exchange — routed LLM inference (cheapest live provider + taker fee)",
          mimeType: "application/json",
        },
      },
      server,
    ),
  );
  log("exchange", `x402 paywall: dynamic quotes in ${ASSET_LABEL}, fee ${EXCHANGE_FEE_BPS} bps via ${facilitatorUrl} → ${exchangeWallet}`);
}

// ---- the router itself ----
app.post("/v1/chat/completions", async (req, res) => {
  const body = req.body as ChatCompletionRequest;
  if (!body?.model || !body?.messages?.length) {
    return res.status(400).json({ error: "model and messages required" });
  }
  // Settle/route against the PINNED quote from the 402 (survives price changes);
  // fall back to fresh routing when no quote exists (e.g. mock direct calls).
  const quote = pinnedQuote(body) ?? routeQuote(body);
  const provider = quote ? providers.get(quote.providerUrl) : undefined;
  if (!quote || !provider || provider.status !== "live") {
    await refreshProviders();
    if (!quote || !providers.get(quote.providerUrl)) {
      return res.status(503).json({ error: `no live provider for model ${body.model}` });
    }
  }
  const pinned = providers.get(quote.providerUrl)!;
  // Decimal views of the pinned quote. The integer base units stay authoritative;
  // these exist for logs, the response envelope, and the request log.
  const quotedPrice = fromBaseUnits(quote.priceUnits);
  const quotedFee = fromBaseUnits(quote.feeUnits);
  const quotedTotal = fromBaseUnits(quote.totalUnits);

  // Verifier replays normally hit providers directly, but anything routed while
  // carrying the audit header is tagged so it stays out of the audit pool.
  const isAudit = req.header(AUDIT_REQUEST_HEADER) === "1";
  const t0 = Date.now();
  try {
    const { res: upstream, paymentRef } = await paidPost(
      `${pinned.url}/v1/chat/completions`,
      body,
      quotedPrice, // pinned provider price — the provider receives exactly its ask at quote time
      pinned.wallet,
    );
    const latencyMs = Date.now() - t0;
    if (!upstream.ok) {
      const text = await upstream.text();
      throw new Error(`provider ${upstream.status}: ${text.slice(0, 200)}`);
    }
    const data = (await upstream.json()) as ChatCompletionResponse;

    pinned.requestsServed++;
    providers.set(pinned.url, pinned);

    const entry: import("@agentrouter/shared").RequestLogEntry = {
      id: `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      model: body.model,
      provider: pinned.displayName,
      providerUrl: pinned.url,
      price: quotedPrice,
      fee: quotedFee,
      total: quotedTotal,
      latencyMs,
      paymentRef,
      promptPreview: body.messages.filter((m) => m.role === "user").at(-1)?.content.slice(0, PROMPT_PREVIEW_LIMIT) ?? "",
      answerPreview: data.choices?.[0]?.message?.content?.slice(0, 80) ?? "",
      status: "ok" as const,
      isAudit,
      // provenance (additive; absent on legacy providers — never mandatory)
      ...(data.servedBy ? { servedBy: data.servedBy } : {}),
      ...(data.upstreamModel ? { upstreamModel: data.upstreamModel } : {}),
    };
    pendingSettles.set(quote.quoteId, entry.id); // real mode: onAfterSettle fills inboundRef + accrues fee
    if (MOCK_MODE) {
      // mock inbound already charged at the gate; accrue + publish equivalents here
      entry.inboundRef = `mock-in-${quote.quoteId}`;
      revenue.requests += 1;
      revenue.volumeUnits += quote.priceUnits;
      revenue.feeUnits += quote.feeUnits;
      consumeQuote(quote);
      broadcast({ type: "stats", stats: statsSnapshot() });
    }
    pushRequest(entry);
    broadcast({ type: "providers", providers: providerList() });
    log(
      "exchange",
      `routed → ${pinned.displayName} (price ${money(quotedPrice)} + fee ${money(quotedFee)} = ${money(quotedTotal)}, ${latencyMs}ms, pay=${paymentRef.slice(0, 18)}…)`,
    );

    res.json({
      ...data,
      agentrouter: {
        provider: pinned.displayName,
        providerWallet: pinned.wallet,
        agentId: pinned.agentId,
        quoteId: quote.quoteId,
        price: quotedPrice, // provider's listed price (provider receives exactly this)
        fee: quotedFee, // exchange taker fee (EXCHANGE_FEE_BPS, ceil in base units)
        total: quotedTotal, // what the agent paid the exchange
        asset: ASSET_LABEL, // what price/fee/total are denominated in
        latencyMs,
        paymentRef, // exchange→provider settle tx (agent→exchange tx lands via X-PAYMENT-RESPONSE header + /log)
      },
    });
  } catch (err) {
    log("exchange", `route FAILED via ${pinned.displayName}: ${(err as Error).message}`);
    // Real mode: the middleware CANCELS the agent's verified payment on non-2xx —
    // the agent is never charged. Mock mode charged the ledger at the gate, so
    // refund it here (REFUND_ON_FAILURE, memo refund:<quoteId>).
    let refundRef: string | undefined;
    let status: "error" | "refunded" = "error";
    if (MOCK_MODE && REFUND_ON_FAILURE) {
      mockLedger.set(exchangeWallet, (mockLedger.get(exchangeWallet) ?? 0) - quotedTotal);
      const r = await sendRefund("0.0.mock-agent", quote.totalUnits, quote.quoteId);
      if (r.ok) {
        refundRef = r.refundRef;
        status = "refunded";
        revenue.refunds += 1;
      } else {
        revenue.refundFailures += 1;
      }
      broadcast({ type: "stats", stats: statsSnapshot() });
      if (!MOCK_MODE) { /* unreachable */ }
      publishToTopic("trades", hederaAccount("EXCHANGE"), {
        type: "refund", model: body.model, provider: pinned.displayName,
        total: quotedTotal, asset: ASSET_LABEL, refundTx: refundRef ?? null, quoteId: quote.quoteId,
      }).catch(() => {});
    }
    consumeQuote(quote);
    pushRequest({
      id: `req-${Date.now().toString(36)}`,
      ts: Date.now(),
      model: body.model,
      provider: pinned.displayName,
      providerUrl: pinned.url,
      price: quotedPrice,
      fee: quotedFee,
      total: quotedTotal,
      latencyMs: Date.now() - t0,
      paymentRef: "-",
      refundRef,
      promptPreview: body.messages.at(-1)?.content.slice(0, PROMPT_PREVIEW_LIMIT) ?? "",
      answerPreview: (err as Error).message.slice(0, 80),
      status,
      isAudit,
    });
    res.status(502).json({ error: (err as Error).message, refunded: status === "refunded", refundRef });
  }
});

// Mock ledger inspection (dashboard + agent balance display in mock mode)
app.get("/mock/ledger", (_req, res) => {
  res.json(Object.fromEntries(mockLedger));
});

app.listen(PORT, () => log("exchange", `AgentRouter exchange listening :${PORT} (MOCK_MODE=${MOCK_MODE})`));
