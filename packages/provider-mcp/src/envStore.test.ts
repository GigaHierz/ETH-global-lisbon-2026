import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// envStore resolves ENV_PATH from AGENTROUTER_ENV_PATH at module load, so each case
// points it at a throwaway .env and re-imports the module fresh.
const dirs: string[] = [];

async function envStoreFor(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), "agentrouter-envstore-"));
  dirs.push(dir);
  const path = join(dir, ".env");
  writeFileSync(path, contents);
  process.env.AGENTROUTER_ENV_PATH = path;
  vi.resetModules();
  const mod = await import("./envStore.js");
  return { mod, path };
}

afterEach(() => {
  delete process.env.AGENTROUTER_ENV_PATH;
  delete process.env.PROVIDER_PUBLIC_URL;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("upsertEnvVar", () => {
  it("appends the key when the file doesn't have it yet", async () => {
    const { mod, path } = await envStoreFor("HEDERA_PROVIDER_ID=0.0.1\n");

    mod.upsertEnvVar("PROVIDER_PUBLIC_URL", "https://acme.tld", "test");

    expect(readFileSync(path, "utf8")).toContain("PROVIDER_PUBLIC_URL=https://acme.tld");
    expect(process.env.PROVIDER_PUBLIC_URL).toBe("https://acme.tld");
  });

  it("REPLACES an existing key instead of appending a duplicate", async () => {
    // Why this matters: readEnvVar() matches with `m` and takes the FIRST hit, while
    // `node --env-file` (how every service boots) takes the LAST. A duplicate key would
    // make this server and the provider service read different values out of one file.
    const { mod, path } = await envStoreFor("PROVIDER_PUBLIC_URL=http://localhost:4025\nSTAKE_HBAR=50\n");

    mod.upsertEnvVar("PROVIDER_PUBLIC_URL", "https://acme.tld", "test");

    const body = readFileSync(path, "utf8");
    expect(body.match(/^PROVIDER_PUBLIC_URL=/gm)).toHaveLength(1);
    expect(body).toContain("PROVIDER_PUBLIC_URL=https://acme.tld");
    expect(body).not.toContain("localhost:4025");
    expect(body).toContain("STAKE_HBAR=50"); // untouched neighbours survive
    expect(mod.readEnvVar("PROVIDER_PUBLIC_URL")).toBe("https://acme.tld");
  });

  it("rewrites pre-existing duplicates so first-match and last-match agree", async () => {
    const { mod, path } = await envStoreFor("PROVIDER_PUBLIC_URL=a\nX=1\nPROVIDER_PUBLIC_URL=b\n");

    mod.upsertEnvVar("PROVIDER_PUBLIC_URL", "https://acme.tld", "test");

    const lines = readFileSync(path, "utf8").match(/^PROVIDER_PUBLIC_URL=.*$/gm) ?? [];
    expect(lines.length).toBeGreaterThan(0);
    expect(new Set(lines)).toEqual(new Set(["PROVIDER_PUBLIC_URL=https://acme.tld"]));
  });

  it("doesn't touch keys that merely share a prefix", async () => {
    const { mod, path } = await envStoreFor("PROVIDER_PUBLIC_URL_BACKUP=keep-me\n");

    mod.upsertEnvVar("PROVIDER_PUBLIC_URL", "https://acme.tld", "test");

    const body = readFileSync(path, "utf8");
    expect(body).toContain("PROVIDER_PUBLIC_URL_BACKUP=keep-me");
    expect(body).toContain("PROVIDER_PUBLIC_URL=https://acme.tld");
  });
});
