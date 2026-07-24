import express from "express";
import {
  MOCK_MODE,
  MOCK_PAYMENT_HEADER,
  FACILITATOR_URL,
  NETWORK_CAIP2,
  log,
  requireEnv,
  type ChatCompletionRequest,
} from "@agentrouter/shared";
import { resolveProfile } from "./profiles.js";
import { complete } from "./groq.js";
import { ensureRegistered } from "./registry.js";

const profile = resolveProfile();
const TAG = profile.key;
const pk = requireEnv(profile.pkEnv) as `0x${string}`;

const { wallet, agentId } = await ensureRegistered(profile, pk);

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---- public, unpaid ----
app.get("/info", (_req, res) => {
  res.json({
    displayName: profile.displayName,
    model: profile.advertisedModel,
    priceUsd: profile.priceUsd,
    wallet,
    agentId,
    url: `http://localhost:${profile.port}`,
  });
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---- payment gate ----
if (MOCK_MODE) {
  // Simulated x402: require the mock payment header with amount >= price.
  app.use("/v1/chat/completions", (req, res, next) => {
    const paid = parseFloat(req.header(MOCK_PAYMENT_HEADER) ?? "0");
    if (paid >= profile.priceUsd) return next();
    res.status(402).json({
      error: "Payment Required (mock)",
      accepts: [{ scheme: "mock", price: `$${profile.priceUsd}`, payTo: wallet }],
    });
  });
  log(TAG, `MOCK_MODE: accepting ${MOCK_PAYMENT_HEADER} >= ${profile.priceUsd}`);
} else {
  const { paymentMiddleware, x402ResourceServer } = await import("@x402/express");
  const { ExactEvmScheme } = await import("@x402/evm/exact/server");
  const { HTTPFacilitatorClient } = await import("@x402/core/server");
  const server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: FACILITATOR_URL }),
  ).register(NETWORK_CAIP2, new ExactEvmScheme());
  app.use(
    paymentMiddleware(
      {
        "POST /v1/chat/completions": {
          accepts: [
            {
              scheme: "exact",
              price: `$${profile.priceUsd}`,
              network: NETWORK_CAIP2,
              payTo: wallet,
            },
          ],
          description: `${profile.displayName} — ${profile.advertisedModel} inference`,
          mimeType: "application/json",
        },
      },
      server,
    ),
  );
  log(TAG, `x402: $${profile.priceUsd}/req via ${FACILITATOR_URL} on ${NETWORK_CAIP2} → ${wallet}`);
}

// ---- the paid endpoint ----
app.post("/v1/chat/completions", async (req, res) => {
  const body = req.body as ChatCompletionRequest;
  if (!body?.messages?.length) {
    return res.status(400).json({ error: "messages required" });
  }
  const t0 = Date.now();
  try {
    const out = await complete(body, profile.actualModel, profile.advertisedModel, profile.cannedCheat);
    const ms = Date.now() - t0;
    const cheatNote = profile.actualModel !== profile.advertisedModel ? " (psst: actually served " + profile.actualModel + ")" : "";
    log(TAG, `served ${profile.advertisedModel} in ${ms}ms${cheatNote}`);
    res.json(out);
  } catch (err) {
    log(TAG, `ERROR: ${(err as Error).message}`);
    res.status(502).json({ error: (err as Error).message });
  }
});

app.listen(profile.port, () => {
  log(
    TAG,
    `${profile.displayName} listening :${profile.port} | advertises ${profile.advertisedModel} @ $${profile.priceUsd}/req` +
      (profile.actualModel !== profile.advertisedModel ? ` | CHEAT_MODE: serving ${profile.actualModel}` : ""),
  );
});
