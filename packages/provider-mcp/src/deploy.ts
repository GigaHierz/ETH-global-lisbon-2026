// "Deploy" here means attach a provider's ALREADY-RUNNING compute to the exchange —
// providers bring their own capacity (VPS/Railway/GPU box). We health-check the
// endpoint, confirm it speaks the provider protocol (/healthz, /info) and that the
// x402 paywall is armed (unpaid inference -> 402), then hand back the public URL to
// register. For anyone who still needs to stand a box up, we also emit the exact
// Railway/VPS config — but we never need their Railway credentials.

export interface EndpointCheck {
  reachable: boolean;
  healthzOk: boolean;
  info: unknown;
  paywallArmed: boolean | null; // null = couldn't determine
  advertisedModel?: string;
  wallet?: string;
  error?: string;
}

const timeout = (ms: number) => AbortSignal.timeout(ms);
const trim = (u: string) => u.replace(/\/+$/, "");

export async function checkEndpoint(publicUrl: string, model: string): Promise<EndpointCheck> {
  const base = trim(publicUrl);
  try {
    const h = await fetch(`${base}/healthz`, { signal: timeout(6000) });
    const healthzOk = h.ok;

    const infoRes = await fetch(`${base}/info`, { signal: timeout(6000) });
    const info = infoRes.ok ? await infoRes.json().catch(() => null) : null;

    // The paywall should reject an unpaid completion with HTTP 402.
    let paywallArmed: boolean | null = null;
    try {
      const unpaid = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }] }),
        signal: timeout(6000),
      });
      paywallArmed = unpaid.status === 402;
    } catch {
      paywallArmed = null;
    }

    const i = (info ?? {}) as { model?: string; wallet?: string };
    return {
      reachable: healthzOk && infoRes.ok,
      healthzOk,
      info,
      paywallArmed,
      advertisedModel: i.model,
      wallet: i.wallet,
    };
  } catch (e) {
    return { reachable: false, healthzOk: false, info: null, paywallArmed: null, error: (e as Error).message };
  }
}

export interface RailwayConfigInput {
  profile: string;
  publicUrl: string;
  providerId: string;
  escrowId: string;
  groqKey?: string;
  cheat?: boolean;
}

/** The exact Railway settings to run the provider service, for someone who needs
 *  to spin up fresh compute. Secrets are placeholders — never emit real keys. */
export function railwayConfig(o: RailwayConfigInput) {
  return {
    builder: "DOCKERFILE",
    dockerfilePath: "Dockerfile",
    startCommand: "pnpm provider:prod",
    important:
      "Do NOT set PORT (Railway injects it). PROVIDER_PUBLIC_URL MUST be this service's public domain — otherwise it registers 'localhost' and the exchange shows it 'down'.",
    env: {
      MOCK_MODE: "false",
      PROVIDER_PROFILE: o.profile,
      PROVIDER_PUBLIC_URL: o.publicUrl,
      HEDERA_PROVIDER_ID: o.providerId,
      HEDERA_PROVIDER_KEY: "<set-as-railway-secret>",
      HEDERA_ESCROW_ID: o.escrowId,
      GROQ_API_KEY: o.groqKey ? "<set-as-railway-secret>" : "<optional-omit-for-canned-answers>",
      CHEAT_MODE: String(o.cheat ?? false),
    },
  };
}
