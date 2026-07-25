import express from "express";
import cors from "cors";
import {
  log,
  MOCK_MODE,
  AUDIT_REQUEST_HEADER,
  MOCK_PAYMENT_HEADER,
  EXCHANGE_FEE_BPS,
  HEDERA_NETWORK,
  HBAR_ASSET,
  hbarOf,
  tinybarsOf,
  feeForPrice,
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
  addSSEClient,
  broadcast,
  pushRequest,
  mockLedger,
  revenue,
  statsSnapshot,
} from "./state.js";
import { startDiscovery, pickProvider, refreshProviders } from "./discovery.js";
import { initPayer, paidPost } from "./payer.js";
import { applySlash } from "./slash.js";
import { quoteFor, pinnedQuote, quoteById, consumeQuote, type Quote } from "./quotes.js";
import { sendRefund, REFUND_ON_FAILURE } from "./refund.js";

// Hosts (Railway/Render/Fly) inject PORT; fall back to EXCHANGE_PORT locally.
const PORT = parseInt(process.env.PORT || process.env.EXCHANGE_PORT || "4100", 10);
// Percentage taker fee: the agent pays provider price + fee (EXCHANGE_FEE_BPS,
// ceil-rounded in tinybars so the exchange never underquotes). Providers always
// receive exactly their listed price; the fee is the exchange's revenue.
const exchangeWallet = MOCK_MODE ? "0.0.mock-exchange" : hederaAccount("EXCHANGE").id;

// quoteId → request-log entry id awaiting its inbound (agent→exchange) settle tx
const pendingSettles = new Map<string, string>();

function routeQuote(body: ChatCompletionRequest): Quote | null {
  return quoteFor(body, pickProvider(body.model), EXCHANGE_FEE_BPS);
}

await initPayer();
startDiscovery();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true, mock: MOCK_MODE }));

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

// Verifier reports each comparison so the dashboard can show verification activity.
app.post("/verify-report", (req, res) => {
  const { provider, witness, similarity, verdict } = req.body;
  broadcast({ type: "verify", provider, witness, similarity, verdict });
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
    const paidTinybar = tinybarsOf(parseFloat(req.header(MOCK_PAYMENT_HEADER) ?? "0"));
    if (paidTinybar >= quote.totalTinybar) {
      // charge the mock ledger up-front (mirrors real settle; refunded on failure)
      mockLedger.set(exchangeWallet, (mockLedger.get(exchangeWallet) ?? 0) + hbarOf(quote.totalTinybar));
      return next();
    }
    return res.status(402).json({
      error: "Payment Required (mock)",
      accepts: [
        {
          scheme: "mock",
          price: `${hbarOf(quote.totalTinybar)} HBAR`,
          payTo: exchangeWallet,
          extra: { quoteId: quote.quoteId, priceHbar: hbarOf(quote.priceTinybar), feeHbar: hbarOf(quote.feeTinybar) },
        },
      ],
    });
  });
  log("exchange", `MOCK paywall: dynamic quote (fee ${EXCHANGE_FEE_BPS} bps) via ${MOCK_PAYMENT_HEADER}`);
} else {
  const { paymentMiddleware, x402ResourceServer } = await import("@x402/express");
  const { ExactHederaScheme } = await import("@x402/hedera/exact/server");
  const { HTTPFacilitatorClient } = await import("@x402/core/server");
  const facilitatorUrl = await resolveFacilitator("exchange");
  const server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: facilitatorUrl }),
  ).register("hedera:*", new ExactHederaScheme());

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
    revenue.volumeTinybar += entry ? tinybarsOf(entry.priceHbar) : (quote?.priceTinybar ?? 0);
    revenue.feeTinybar += entry ? tinybarsOf(entry.feeHbar) : (quote?.feeTinybar ?? 0);
    broadcast({ type: "stats", stats: statsSnapshot() });
    if (quote) consumeQuote(quote);
    log("exchange", `inbound settled ${inboundRef.slice(0, 24)}… (quote ${quoteId}) — fee revenue now ${statsSnapshot().feeRevenueHbar.toFixed(4)} ℏ`);
    if (entry) {
      publishToTopic("trades", hederaAccount("EXCHANGE"), {
        type: "trade",
        model: entry.model,
        provider: entry.provider,
        providerAccount: providerList().find((pr) => pr.displayName === entry.provider)?.wallet ?? "?",
        priceHbar: entry.priceHbar,
        feeHbar: entry.feeHbar,
        totalHbar: entry.totalHbar,
        latencyMs: entry.latencyMs,
        inboundTx: inboundRef,
        paymentTx: entry.paymentRef,
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
                  return { amount: "0", asset: HBAR_ASSET };
                }
                return {
                  amount: String(quote.totalTinybar),
                  asset: HBAR_ASSET,
                  extra: { quoteId: quote.quoteId, priceTinybar: String(quote.priceTinybar), feeTinybar: String(quote.feeTinybar) },
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
  log("exchange", `x402 paywall: dynamic quotes, fee ${EXCHANGE_FEE_BPS} bps via ${facilitatorUrl} → ${exchangeWallet}`);
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
  const priceHbarQ = hbarOf(quote.priceTinybar);
  const feeHbarQ = hbarOf(quote.feeTinybar);
  const totalHbarQ = hbarOf(quote.totalTinybar);

  // Verifier replays normally hit providers directly, but anything routed while
  // carrying the audit header is tagged so it stays out of the audit pool.
  const isAudit = req.header(AUDIT_REQUEST_HEADER) === "1";
  const t0 = Date.now();
  try {
    const { res: upstream, paymentRef } = await paidPost(
      `${pinned.url}/v1/chat/completions`,
      body,
      priceHbarQ, // pinned provider price — the provider receives exactly its ask at quote time
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
      priceHbar: priceHbarQ,
      feeHbar: feeHbarQ,
      totalHbar: totalHbarQ,
      latencyMs,
      paymentRef,
      promptPreview: body.messages.filter((m) => m.role === "user").at(-1)?.content.slice(0, 80) ?? "",
      answerPreview: data.choices?.[0]?.message?.content?.slice(0, 80) ?? "",
      status: "ok" as const,
      isAudit,
    };
    pendingSettles.set(quote.quoteId, entry.id); // real mode: onAfterSettle fills inboundRef + accrues fee
    if (MOCK_MODE) {
      // mock inbound already charged at the gate; accrue + publish equivalents here
      entry.inboundRef = `mock-in-${quote.quoteId}`;
      revenue.requests += 1;
      revenue.volumeTinybar += quote.priceTinybar;
      revenue.feeTinybar += quote.feeTinybar;
      consumeQuote(quote);
      broadcast({ type: "stats", stats: statsSnapshot() });
    }
    pushRequest(entry);
    broadcast({ type: "providers", providers: providerList() });
    log(
      "exchange",
      `routed → ${pinned.displayName} (price ${priceHbarQ} + fee ${feeHbarQ} = ${totalHbarQ} ℏ, ${latencyMs}ms, pay=${paymentRef.slice(0, 18)}…)`,
    );

    res.json({
      ...data,
      agentrouter: {
        provider: pinned.displayName,
        providerWallet: pinned.wallet,
        agentId: pinned.agentId,
        quoteId: quote.quoteId,
        priceHbar: priceHbarQ, // provider's listed price (provider receives exactly this)
        feeHbar: feeHbarQ, // exchange taker fee (EXCHANGE_FEE_BPS, ceil in tinybars)
        totalHbar: totalHbarQ, // what the agent paid the exchange
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
      mockLedger.set(exchangeWallet, (mockLedger.get(exchangeWallet) ?? 0) - totalHbarQ);
      const r = await sendRefund("0.0.mock-agent", quote.totalTinybar, quote.quoteId);
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
        totalHbar: totalHbarQ, refundTx: refundRef ?? null, quoteId: quote.quoteId,
      }).catch(() => {});
    }
    consumeQuote(quote);
    pushRequest({
      id: `req-${Date.now().toString(36)}`,
      ts: Date.now(),
      model: body.model,
      provider: pinned.displayName,
      providerUrl: pinned.url,
      priceHbar: priceHbarQ,
      feeHbar: feeHbarQ,
      totalHbar: totalHbarQ,
      latencyMs: Date.now() - t0,
      paymentRef: "-",
      refundRef,
      promptPreview: body.messages.at(-1)?.content.slice(0, 80) ?? "",
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
