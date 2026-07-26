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

export type Backend = "0g" | "groq" | "canned";

export interface RailwayConfigInput {
  profile: string;
  publicUrl: string;
  providerId: string;
  escrowId: string;
  role?: string;
  backend?: Backend; // where inference comes from; default 0g (recommended)
  keyConfigured?: boolean; // whether the chosen backend's API key will be set on the box
  cheat?: boolean;
}

// The env var each backend reads for its API key. canned needs none.
const BACKEND_KEY: Record<Backend, string | null> = {
  "0g": "ZEROG_API_KEY",
  groq: "GROQ_API_KEY",
  canned: null,
};

// Where a provider gets that key, for the emitted secret hint.
const BACKEND_KEY_SOURCE: Record<string, string> = {
  ZEROG_API_KEY: "your 0G Compute API key (get one at pc.0g.ai, fund it with 0G testnet tokens)",
  GROQ_API_KEY: "your Groq API key (console.groq.com/keys)",
};

/** The exact Railway settings to run the provider service, for someone who needs
 *  to spin up fresh compute. Secrets are placeholders — never emit real keys.
 *
 *  Note the deliberate rename: the account is stored locally as HEDERA_<role>_*, but
 *  the deployed service runs the `custom` profile, which always reads HEDERA_PROVIDER_*.
 *  We emit the right *value* under the name the service expects, and `secrets` says
 *  which local var to copy it from — otherwise a non-default role can't be deployed.
 *
 *  The backend controls which API key we wire up: 0g → ZEROG_API_KEY (default), groq →
 *  GROQ_API_KEY, canned → no key. Omit the key and the service falls back to deterministic
 *  canned answers, still honest about the advertised model. */
export function railwayConfig(o: RailwayConfigInput) {
  const role = o.role ?? "PROVIDER";
  const backend: Backend = o.backend ?? "0g";
  const keyVar = BACKEND_KEY[backend];
  return {
    builder: "DOCKERFILE",
    dockerfilePath: "Dockerfile",
    startCommand: "pnpm provider:prod",
    important:
      "Do NOT set PORT (Railway injects it). PROVIDER_PUBLIC_URL MUST be this service's public domain — otherwise it registers 'localhost' and the exchange shows it 'down'.",
    secrets: {
      HEDERA_PROVIDER_KEY: `copy the value of HEDERA_${role}_KEY from your .env`,
      ...(keyVar && o.keyConfigured ? { [keyVar]: BACKEND_KEY_SOURCE[keyVar] } : {}),
    },
    env: {
      MOCK_MODE: "false",
      PROVIDER_PROFILE: o.profile,
      PROVIDER_BACKEND: backend,
      PROVIDER_PUBLIC_URL: o.publicUrl,
      HEDERA_PROVIDER_ID: o.providerId,
      HEDERA_PROVIDER_KEY: "<set-as-railway-secret>",
      HEDERA_ESCROW_ID: o.escrowId,
      ...(keyVar
        ? { [keyVar]: o.keyConfigured ? "<set-as-railway-secret>" : "<optional-omit-for-canned-answers>" }
        : {}),
      CHEAT_MODE: String(o.cheat ?? false),
    },
  };
}
