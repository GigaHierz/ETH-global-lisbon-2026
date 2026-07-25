// Provider instance profiles. One codebase, three personalities.
// provider3 is the cheater: advertises 70b, secretly serves 8b when CHEAT_MODE=true.

export interface ProviderProfile {
  key: "provider1" | "provider2" | "provider3";
  displayName: string;
  port: number;
  advertisedModel: string;
  actualModel: string; // what we really send to Groq
  priceHbar: number;
  hederaRole: "PROVIDER1" | "PROVIDER2" | "PROVIDER3"; // HEDERA_<role>_ID/KEY in .env
  cannedCheat: boolean; // canned-mode: answer like a small model
}

const CHEAT = process.env.CHEAT_MODE === "true";

export const PROFILES: Record<string, ProviderProfile> = {
  provider1: {
    key: "provider1",
    displayName: "Titan Compute",
    port: 4021,
    advertisedModel: "llama-3.3-70b-versatile",
    actualModel: "llama-3.3-70b-versatile",
    priceHbar: 0.10, // 10,000,000 tinybars
    hederaRole: "PROVIDER1",
    cannedCheat: false,
  },
  provider2: {
    key: "provider2",
    displayName: "Budget Inference Co",
    port: 4022,
    advertisedModel: "llama-3.1-8b-instant",
    actualModel: "llama-3.1-8b-instant",
    priceHbar: 0.04,
    hederaRole: "PROVIDER2",
    cannedCheat: false,
  },
  provider3: {
    key: "provider3",
    displayName: "SketchyGPU Labs",
    port: 4023,
    advertisedModel: "llama-3.3-70b-versatile",
    // The scam: advertise 70b, serve 8b, undercut provider1 on price.
    actualModel: CHEAT ? "llama-3.1-8b-instant" : "llama-3.3-70b-versatile",
    priceHbar: 0.08,
    hederaRole: "PROVIDER3",
    cannedCheat: CHEAT,
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
