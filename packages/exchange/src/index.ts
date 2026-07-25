import express from "express";
import cors from "cors";
import {
  log,
  MOCK_MODE,
  AUDIT_REQUEST_HEADER,
  MOCK_PAYMENT_HEADER,
  DEFAULT_EXCHANGE_ASK,
  HEDERA_NETWORK,
  ASSET_LABEL,
  ASSET_SYMBOL,
  money,
  SCHEME_CONFIG,
  SETTLEMENT_ASSET,
  settlementPrice,
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
} from "./state.js";
import { startDiscovery, pickProvider, refreshProviders } from "./discovery.js";
import { initPayer, paidPost } from "./payer.js";
import { applySlash } from "./slash.js";

// Hosts (Railway/Render/Fly) inject PORT; fall back to EXCHANGE_PORT locally.
const PORT = parseInt(process.env.PORT || process.env.EXCHANGE_PORT || "4100", 10);
// The flat x402 ask the agent pays the exchange per request. The exchange routes
// to the cheapest live provider and keeps the spread (ask − provider cost); that
// margin compresses when the verifier slashes a fraudulent low-baller out of routing.
const EXCHANGE_ASK = parseFloat(process.env.EXCHANGE_ASK || String(DEFAULT_EXCHANGE_ASK));
const exchangeWallet = MOCK_MODE ? "0.0.mock-exchange" : hederaAccount("EXCHANGE").id;

await initPayer();
startDiscovery();

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

// ---- payment gate: the agent pays the exchange's flat ask via x402 ----
if (MOCK_MODE) {
  app.use("/v1/chat/completions", (req, res, next) => {
    if (req.method !== "POST") return next();
    const paid = parseFloat(req.header(MOCK_PAYMENT_HEADER) ?? "0");
    if (paid >= EXCHANGE_ASK) return next();
    return res.status(402).json({
      error: "Payment Required (mock)",
      accepts: [{ scheme: "mock", price: `${EXCHANGE_ASK} ${ASSET_LABEL}`, payTo: exchangeWallet }],
    });
  });
  log("exchange", `MOCK paywall: require ${MOCK_PAYMENT_HEADER} >= ${money(EXCHANGE_ASK)}`);
} else {
  const { paymentMiddleware, x402ResourceServer } = await import("@x402/express");
  const { ExactHederaScheme } = await import("@x402/hedera/exact/server");
  const { HTTPFacilitatorClient } = await import("@x402/core/server");
  const facilitatorUrl = await resolveFacilitator("exchange");
  const server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: facilitatorUrl }),
  ).register("hedera:*", new ExactHederaScheme(SCHEME_CONFIG));
  app.use(
    paymentMiddleware(
      {
        "POST /v1/chat/completions": {
          accepts: [
            {
              scheme: "exact",
              price: settlementPrice(EXCHANGE_ASK),
              network: HEDERA_NETWORK,
              payTo: exchangeWallet,
            },
          ],
          description: "AgentRouter exchange — routed LLM inference (cheapest live provider)",
          mimeType: "application/json",
        },
      },
      server,
    ),
  );
  log("exchange", `x402 paywall: ${money(EXCHANGE_ASK)}/req via ${facilitatorUrl} → ${exchangeWallet}`);
}

// ---- the router itself ----
app.post("/v1/chat/completions", async (req, res) => {
  const body = req.body as ChatCompletionRequest;
  if (!body?.model || !body?.messages?.length) {
    return res.status(400).json({ error: "model and messages required" });
  }
  const provider = pickProvider(body.model);
  if (!provider) {
    await refreshProviders();
    return res.status(503).json({ error: `no live provider for model ${body.model}` });
  }

  // Verifier replays normally hit providers directly, but anything routed while
  // carrying the audit header is tagged so it stays out of the audit pool.
  const isAudit = req.header(AUDIT_REQUEST_HEADER) === "1";
  const t0 = Date.now();
  try {
    const { res: upstream, paymentRef } = await paidPost(
      `${provider.url}/v1/chat/completions`,
      body,
      provider.price,
      provider.wallet,
    );
    const latencyMs = Date.now() - t0;
    if (!upstream.ok) {
      const text = await upstream.text();
      throw new Error(`provider ${upstream.status}: ${text.slice(0, 200)}`);
    }
    const data = (await upstream.json()) as ChatCompletionResponse;

    provider.requestsServed++;
    providers.set(provider.url, provider);

    const entry = {
      id: `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      ts: Date.now(),
      model: body.model,
      provider: provider.displayName,
      providerUrl: provider.url,
      price: provider.price,
      latencyMs,
      paymentRef,
      promptPreview: body.messages.filter((m) => m.role === "user").at(-1)?.content.slice(0, 80) ?? "",
      answerPreview: data.choices?.[0]?.message?.content?.slice(0, 80) ?? "",
      status: "ok" as const,
      isAudit,
    };
    pushRequest(entry);
    broadcast({ type: "providers", providers: providerList() });
    log(
      "exchange",
      `routed → ${provider.displayName} (${money(provider.price)}, ${latencyMs}ms, pay=${paymentRef.slice(0, 18)}…)`,
    );
    if (!MOCK_MODE) {
      publishToTopic("trades", hederaAccount("EXCHANGE"), {
        type: "trade",
        model: body.model,
        provider: provider.displayName,
        providerAccount: provider.wallet,
        price: provider.price,
        asset: ASSET_LABEL, // immutable log: the price unit has to travel with the price
        latencyMs,
        paymentTx: paymentRef,
      }).catch((e) => log("exchange", `HCS trade publish failed: ${(e as Error).message.slice(0, 80)}`));
    }

    res.json({
      ...data,
      agentrouter: {
        provider: provider.displayName,
        providerWallet: provider.wallet,
        agentId: provider.agentId,
        pricePaid: EXCHANGE_ASK, // what the agent paid the exchange (x402 ask)
        providerCost: provider.price, // what the exchange paid the provider
        margin: Number((EXCHANGE_ASK - provider.price).toFixed(8)),
        asset: ASSET_LABEL, // what pricePaid/providerCost/margin are denominated in
        latencyMs,
        paymentRef, // exchange→provider settle tx
      },
    });
  } catch (err) {
    log("exchange", `route FAILED via ${provider.displayName}: ${(err as Error).message}`);
    pushRequest({
      id: `req-${Date.now().toString(36)}`,
      ts: Date.now(),
      model: body.model,
      provider: provider.displayName,
      providerUrl: provider.url,
      price: provider.price,
      latencyMs: Date.now() - t0,
      paymentRef: "-",
      promptPreview: body.messages.at(-1)?.content.slice(0, 80) ?? "",
      answerPreview: (err as Error).message.slice(0, 80),
      status: "error",
      isAudit,
    });
    res.status(502).json({ error: (err as Error).message });
  }
});

// Mock ledger inspection (dashboard + agent balance display in mock mode)
app.get("/mock/ledger", (_req, res) => {
  res.json(Object.fromEntries(mockLedger));
});

app.listen(PORT, () => log("exchange", `AgentRouter exchange listening :${PORT} (MOCK_MODE=${MOCK_MODE})`));
