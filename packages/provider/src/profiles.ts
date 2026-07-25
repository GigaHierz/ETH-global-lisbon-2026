// Provider instance profiles. One codebase, four personalities.
// provider3 is the cheater: advertises 70b, secretly serves 8b when CHEAT_MODE=true.

import { DEFAULT_MODEL, SMALL_MODEL, PROVIDER_PORTS } from "@agentrouter/shared";

export interface ProviderProfile {
  key: "provider1" | "provider2" | "provider3" | "provider4";
  displayName: string;
  port: number;
  advertisedModel: string;
  actualModel: string; // what we really send to Groq
  priceHbar: number;
  hederaRole: "PROVIDER1" | "PROVIDER2" | "PROVIDER3" | "PROVIDER4"; // HEDERA_<role>_ID/KEY in .env
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
    cannedCheat: CHEAT,
  },
  provider4: {
    key: "provider4",
    displayName: "NimbusAI",
    port: PROVIDER_PORTS[3],
    advertisedModel: DEFAULT_MODEL,
    actualModel: DEFAULT_MODEL, // honest: serves exactly what it advertises
    priceHbar: 0.06, // undercuts Titan's 0.10 on 70b, but plays fair — survives verification
    hederaRole: "PROVIDER4",
    cannedCheat: false,
  },
};

export function resolveProfile(): ProviderProfile {
  const idx = process.argv.indexOf("--profile");
  const key = idx >= 0 ? process.argv[idx + 1] : process.env.PROVIDER_PROFILE;
  const profile = key ? PROFILES[key] : undefined;
  if (!profile) {
    console.error(`Unknown provider profile "${key}". Use --profile provider1|provider2|provider3`);
    process.exit(1);
  }
  return profile;
}
