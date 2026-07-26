// Idempotent .env access, mirroring scripts/setup-hedera-accounts.ts:
// account rows are appended to a .env file and re-reads skip roles already
// present. The path defaults to the monorepo root .env but can be pointed at a
// provider's own .env via AGENTROUTER_ENV_PATH (external operators bring their own).

import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

export const ENV_PATH = process.env.AGENTROUTER_ENV_PATH
  ? resolve(process.env.AGENTROUTER_ENV_PATH)
  : resolve(import.meta.dirname, "../../../.env"); // packages/provider-mcp/src -> repo root

// registry.ts keys its stake/registration cache by account id in this file.
export const CACHE_PATH = resolve(dirname(ENV_PATH), ".registry-cache.json");
export const REPO_ROOT = dirname(ENV_PATH);

/** Prefer the live process env, fall back to the .env file. Never throws. */
export function readEnvVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  try {
    const m = readFileSync(ENV_PATH, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    return m?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Append `KEY=value` lines to the .env file AND reflect them into the running
 * process, so a later tool in the same provisioning run sees them immediately.
 */
export function appendEnvLines(lines: string[], header: string): void {
  const stamp = new Date().toISOString();
  appendFileSync(ENV_PATH, `\n# ── ${header} (${stamp}) ──\n${lines.join("\n")}\n`);
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq > 0) process.env[line.slice(0, eq)] = line.slice(eq + 1);
  }
}

/**
 * Set `KEY=value` in the .env file, replacing ALL existing lines for that key,
 * and reflect it into the running process.
 *
 * Must replace rather than append: readEnvVar() matches with the `m` flag and so
 * takes the FIRST occurrence, while `node --env-file` (how every service boots)
 * takes the LAST. A duplicate key would make this server and the provider service
 * read different values out of the same file.
 */
export function upsertEnvVar(name: string, value: string, header: string): void {
  const line = `${name}=${value}`;
  let body = "";
  try {
    body = readFileSync(ENV_PATH, "utf8");
  } catch {
    /* no .env yet — fall through to the append path below */
  }
  const existing = new RegExp(`^${name}=.*$`, "gm");
  if (!body.match(existing)) {
    appendEnvLines([line], header);
    return; // appendEnvLines already mirrored it into process.env
  }
  writeFileSync(ENV_PATH, body.replace(existing, line));
  process.env[name] = value;
}

/** Load the .env file into process.env at startup (Node 22 built-in). Best-effort. */
export function loadEnv(): void {
  try {
    (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(ENV_PATH);
  } catch {
    /* no .env yet, or already loaded — tools read live env + file directly anyway */
  }
}

export function readCache(): Record<string, { staked?: string; registered?: string; endpoint?: string }> {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

export function writeCache(c: Record<string, unknown>): void {
  writeFileSync(CACHE_PATH, JSON.stringify(c, null, 2));
}
