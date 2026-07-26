import express from "express";
import {
  MOCK_MODE,
  MOCK_PAYMENT_HEADER,
  HEDERA_NETWORK,
  ASSET_LABEL,
  ASSET_SYMBOL,
  money,
  SCHEME_CONFIG,
  settlementPrice,
  resolveFacilitator,
  log,
  type ChatCompletionRequest,
} from "@agentrouter/shared";
import { resolveProfile } from "./profiles.js";
import { complete } from "./backends/index.js";
import { ensureRegistered } from "./registry.js";

const profile = resolveProfile();
const TAG = profile.key;

// Hosting (Railway etc.): bind to the injected PORT and advertise a public URL so a
// remote exchange can reach us. Locally (neither set) this stays localhost:profile.port — unchanged.
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : profile.port;
const PUBLIC_URL = process.env.PROVIDER_PUBLIC_URL || `http://localhost:${PORT}`;

const { wallet, agentId } = await ensureRegistered(profile);

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---- public, unpaid ----
app.get("/info", (_req, res) => {
  res.json({
    displayName: profile.displayName,
    model: profile.advertisedModel,
    price: profile.price,
    wallet,
    agentId,
    url: PUBLIC_URL,
  });
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// ---- payment gate ----
if (MOCK_MODE) {
  // Simulated x402: require the mock payment header with amount >= price.
  app.use("/v1/chat/completions", (req, res, next) => {
    const paid = parseFloat(req.header(MOCK_PAYMENT_HEADER) ?? "0");
    if (paid >= profile.price) return next();
    res.status(402).json({
      error: "Payment Required (mock)",
      accepts: [{ scheme: "mock", price: `${profile.price} ${ASSET_LABEL}`, payTo: wallet }],
    });
  });
  log(TAG, `MOCK_MODE: accepting ${MOCK_PAYMENT_HEADER} >= ${profile.price}`);
} else {
  const { paymentMiddleware, x402ResourceServer } = await import("@x402/express");
  const { ExactHederaScheme } = await import("@x402/hedera/exact/server");
  const { HTTPFacilitatorClient } = await import("@x402/core/server");
  const facilitatorUrl = await resolveFacilitator(TAG);
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
              price: settlementPrice(profile.price),
              network: HEDERA_NETWORK,
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
  log(TAG, `x402: ${money(profile.price)}/req via ${facilitatorUrl} on ${HEDERA_NETWORK} → ${wallet}`);
}

// ---- the paid endpoint ----
app.post("/v1/chat/completions", async (req, res) => {
  const body = req.body as ChatCompletionRequest;
  if (!body?.messages?.length) {
    return res.status(400).json({ error: "messages required" });
  }
  const t0 = Date.now();
  try {
    const out = await complete(profile.backend, body, profile.actualModel, profile.advertisedModel, profile.cannedCheat);
    const ms = Date.now() - t0;
    const cheatNote = profile.actualModel !== profile.advertisedModel ? " (psst: actually served " + profile.actualModel + ")" : "";
    log(TAG, `served ${profile.advertisedModel} in ${ms}ms${cheatNote}`);
    res.json(out);
  } catch (err) {
    log(TAG, `ERROR: ${(err as Error).message}`);
    res.status(502).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  log(
    TAG,
    `${profile.displayName} listening :${PORT} (${PUBLIC_URL}) | advertises ${profile.advertisedModel} @ ${money(profile.price)}/req` +
      (profile.actualModel !== profile.advertisedModel ? ` | CHEAT_MODE: serving ${profile.actualModel}` : ""),
  );
});
