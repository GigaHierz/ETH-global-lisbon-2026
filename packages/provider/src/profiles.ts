// Provider instance profiles. One codebase, four personalities.
// provider3 is the cheater: advertises 70b, secretly serves 8b when CHEAT_MODE=true.

import { DEFAULT_MODEL, SMALL_MODEL, ZEROG_MODEL, PROVIDER_PORTS } from "@agentrouter/shared";
import { DEFAULT_BACKEND, type ProviderBackend } from "./backends/index.js";

export interface ProviderProfile {
  key: "provider1" | "provider2" | "provider3" | "provider4" | "custom";
  displayName: string;
  port: number;
  advertisedModel: string;
  actualModel: string; // what we really send to Groq
  priceHbar: number;
  hederaRole: "PROVIDER1" | "PROVIDER2" | "PROVIDER3" | "PROVIDER4" | "PROVIDER"; // HEDERA_<role>_ID/KEY in .env
  backend: ProviderBackend; // where compute comes from; p1-p3 pin groq (frozen demo arc)
  cannedCheat: boolean; // canned-mode: answer like a small model
}

const CHEAT = process.env.CHEAT_MODE === "true";

export const PROFILES: Record<string, ProviderProfile> = {
  provider1: {
    key: "provider1",
    displayName: "Titan Compute",
    port: PROVIDER_PORTS[0],
    advertisedModel: DEFAULT_MODEL,
    actualModel: DEFAULT_MODEL,
    priceHbar: 0.10, // 10,000,000 tinybars
    hederaRole: "PROVIDER1",
    backend: "groq", // FROZEN: slash arc depends on deterministic Groq — do not change
    cannedCheat: false,
  },
  provider2: {
    key: "provider2",
    displayName: "Budget Inference Co",
    port: PROVIDER_PORTS[1],
    advertisedModel: SMALL_MODEL,
    actualModel: SMALL_MODEL,
    priceHbar: 0.04,
    hederaRole: "PROVIDER2",
    backend: "groq", // FROZEN: slash arc depends on deterministic Groq — do not change
    cannedCheat: false,
  },
  provider3: {
    key: "provider3",
    displayName: "SketchyGPU Labs",
    port: PROVIDER_PORTS[2],
    advertisedModel: DEFAULT_MODEL,
    // The scam: advertise 70b, serve 8b, undercut provider1 on price.
    actualModel: CHEAT ? SMALL_MODEL : DEFAULT_MODEL,
    priceHbar: 0.08,
    hederaRole: "PROVIDER3",
    backend: "groq", // FROZEN: slash arc depends on deterministic Groq — do not change
    cannedCheat: CHEAT,
  },
  provider4: {
    key: "provider4",
    displayName: "NimbusAI",
    port: PROVIDER_PORTS[3],
    // 0G Compute personality: honest reseller of 0G's decentralized GPU network.
    // Unique model id on the exchange → competes only for its own model, so the
    // p1/p3 llama-70b slash arc is untouched.
    advertisedModel: ZEROG_MODEL,
    actualModel: ZEROG_MODEL,
    priceHbar: 0.06,
    hederaRole: "PROVIDER4",
    backend: "0g",
    cannedCheat: false,
  },
};

// A fully env-driven provider — for anyone listing their own compute on AgentRouter
// without editing this file. Advertise = serve (honest); the account is HEDERA_PROVIDER_ID/KEY.
//   PROVIDER_NAME, PROVIDER_MODEL, PROVIDER_PRICE_HBAR, PROVIDER_PORT
function customProfile(): ProviderProfile {
  const model = process.env.PROVIDER_MODEL || (process.env.PROVIDER_BACKEND === "groq" ? DEFAULT_MODEL : ZEROG_MODEL);
  return {
    key: "custom",
    displayName: process.env.PROVIDER_NAME || "Custom Provider",
    port: parseInt(process.env.PROVIDER_PORT || "4025", 10),
    advertisedModel: model,
    actualModel: model, // honest: serve exactly what you advertise (the verifier checks this)
    priceHbar: parseFloat(process.env.PROVIDER_PRICE_HBAR || "0.10"),
    hederaRole: "PROVIDER",
    // Bring-your-own supply defaults to the 0G Compute network; override with
    // PROVIDER_BACKEND=groq|canned (ollama: planned).
    backend: (process.env.PROVIDER_BACKEND as ProviderBackend) || DEFAULT_BACKEND,
    cannedCheat: false,
  };
}

export function resolveProfile(): ProviderProfile {
  const idx = process.argv.indexOf("--profile");
  const key = idx >= 0 ? process.argv[idx + 1] : process.env.PROVIDER_PROFILE;
  if (key === "custom") return customProfile();
  const profile = key ? PROFILES[key] : undefined;
  if (!profile) {
    console.error(`Unknown provider profile "${key}". Use --profile provider1|provider2|provider3|provider4|custom`);
    process.exit(1);
  }
  return profile;
}
