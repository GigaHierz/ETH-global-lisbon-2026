// HCS audit trail: three consensus topics (registry / trades / verdicts).
// Real mode: TopicMessageSubmitTransaction per event; readers use Mirror Node
// REST (1-5s lag, messages arrive base64-encoded). Mock mode: no-ops.

import fs from "node:fs";
import path from "node:path";
import { MIRROR_NODE, hashscanTopic } from "./hedera.js";

export type TopicName = "registry" | "trades" | "verdicts";

function deploymentsPath(): string {
  // repo root: shared/src → ../..
  return path.resolve(process.cwd(), "deployments.json");
}

export function getTopicId(name: TopicName): string | null {
  const envVar = `HCS_${name.toUpperCase()}_TOPIC`;
  if (process.env[envVar]) return process.env[envVar]!;
  try {
    const d = JSON.parse(fs.readFileSync(deploymentsPath(), "utf8"));
    return d.hederaTestnet?.topics?.[name] ?? null;
  } catch {
    return null;
  }
}

export function topicLinks(): Record<TopicName, { id: string | null; hashscan: string | null }> {
  const out = {} as Record<TopicName, { id: string | null; hashscan: string | null }>;
  for (const name of ["registry", "trades", "verdicts"] as TopicName[]) {
    const id = getTopicId(name);
    out[name] = { id, hashscan: id ? hashscanTopic(id) : null };
  }
  return out;
}

/* v8 ignore start -- Hedera SDK + Mirror Node network I/O; real mode only */
// Publish a JSON message to a topic, signed/paid by the given account.
// Fire-and-forget friendly: callers may .catch(log) — never block the hot path.
export async function publishToTopic(
  topic: TopicName,
  payer: { id: string; key: string },
  message: Record<string, unknown>,
): Promise<string> {
  const topicId = getTopicId(topic);
  if (!topicId) throw new Error(`no ${topic} topic id — run \`pnpm setup-hcs\``);
  const { Client, AccountId, PrivateKey, TopicMessageSubmitTransaction } = await import("@hiero-ledger/sdk");
  const client = Client.forTestnet().setOperator(
    AccountId.fromString(payer.id),
    PrivateKey.fromStringECDSA(payer.key),
  );
  try {
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(JSON.stringify({ ...message, ts: Date.now() }))
      .execute(client);
    await tx.getReceipt(client);
    return tx.transactionId!.toString();
  } finally {
    client.close();
  }
}

export interface TopicMessage {
  consensusTs: string;
  sequence: number;
  payload: Record<string, unknown> | null;
}

// Read recent messages from a topic via Mirror Node REST (base64 → JSON).
export async function readTopicMessages(topic: TopicName, limit = 25): Promise<TopicMessage[]> {
  const topicId = getTopicId(topic);
  if (!topicId) return [];
  const res = await fetch(`${MIRROR_NODE}/api/v1/topics/${topicId}/messages?order=desc&limit=${limit}`);
  if (!res.ok) return [];
  const body = (await res.json()) as {
    messages?: Array<{ consensus_timestamp: string; sequence_number: number; message: string }>;
  };
  return (body.messages ?? []).map((m) => {
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(Buffer.from(m.message, "base64").toString("utf8"));
    } catch {
      /* non-JSON message — keep null */
    }
    return { consensusTs: m.consensus_timestamp, sequence: m.sequence_number, payload };
  });
}
/* v8 ignore stop */
