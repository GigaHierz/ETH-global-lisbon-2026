// The buyer agent's on-chain identity. It registers an HCS-14 Universal Agent ID
// (uaid:aid:hedera:testnet:0.0.x) to the shared HCS registry topic — the same
// directory the providers register into — so buyers and sellers are one
// discoverable set. Registration is submitted via the Hedera Agent Kit (the
// agent's on-chain "hands"), per the design.

import { getTopicId, hashscanTx, hederaAccount, MOCK_MODE, log } from "@agentrouter/shared";

export function agentUaid(accountId: string): string {
  return `uaid:aid:hedera:testnet:${accountId}`;
}

export interface AgentRegistration {
  type: "agent-identity"; // NOT "registration" — providers use that; keeps the agent out of sellable discovery
  standard: "HCS-14";
  agentId: string; // the UAID
  account: string;
  role: "buyer";
  displayName: string;
  endpoint: string;
  capabilities: string[];
}

export function buildRegistration(
  accountId: string,
  opts: { displayName: string; endpoint: string },
): AgentRegistration {
  return {
    type: "agent-identity",
    standard: "HCS-14",
    agentId: agentUaid(accountId),
    account: accountId,
    role: "buyer",
    displayName: opts.displayName,
    endpoint: opts.endpoint,
    capabilities: ["x402-payer", "autonomous-buyer"],
  };
}

export interface Identity {
  agentId: string;
  account: string;
  hashscan: string; // account link
  registeredTx?: string; // registration tx id
  registeredHashscan?: string;
}

/**
 * Register the agent's HCS-14 identity on the registry topic using the Hedera
 * Agent Kit's consensus (HCS) tool. Idempotency isn't enforced on-chain — HCS is
 * append-only — so the caller registers once per boot.
 */
export async function registerIdentity(opts: {
  displayName: string;
  endpoint: string;
}): Promise<Identity> {
  const { id } = hederaAccount("AGENT");
  const agentId = agentUaid(id);
  const account = { agentId, account: id, hashscan: `https://hashscan.io/testnet/account/${id}` };

  if (MOCK_MODE) {
    log("agent", `MOCK identity: ${agentId}`);
    return account;
  }

  const topicId = getTopicId("registry");
  if (!topicId) {
    log("agent", "WARN no registry topic id — skipping identity registration");
    return account;
  }

  const record = buildRegistration(id, opts);

  try {
    const { key } = hederaAccount("AGENT");
    const { HederaLangchainToolkit, coreConsensusPlugin, coreConsensusPluginToolNames, AgentMode } =
      await import("hedera-agent-kit");
    const { Client, AccountId, PrivateKey } = await import("@hashgraph/sdk");

    const client = Client.forTestnet().setOperator(
      AccountId.fromString(id),
      PrivateKey.fromStringECDSA(key),
    );
    const toolkit = new HederaLangchainToolkit({
      client,
      configuration: {
        tools: [coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL],
        plugins: [coreConsensusPlugin],
        context: { mode: AgentMode.AUTONOMOUS },
      },
    });
    const tools = toolkit.getTools() as { name: string; invoke: (a: unknown) => Promise<unknown> }[];
    const submit = tools.find((t) => t.name === coreConsensusPluginToolNames.SUBMIT_TOPIC_MESSAGE_TOOL);
    if (!submit) throw new Error("Agent Kit: submit_topic_message_tool not found");

    const out = await submit.invoke({ topicId, message: JSON.stringify(record) });
    client.close();

    const txId = extractTxId(out);
    log("agent", `HCS-14 identity registered via Agent Kit: ${agentId}${txId ? ` (${hashscanTx(txId)})` : ""}`);
    return {
      ...account,
      registeredTx: txId,
      registeredHashscan: txId ? hashscanTx(txId) : undefined,
    };
  } catch (e) {
    log("agent", `WARN Agent Kit identity registration failed (${(e as Error).message.slice(0, 140)})`);
    return account;
  }
}

/** The Agent Kit tool returns a string/object; dig out a Hedera tx id if present. */
function extractTxId(out: unknown): string | undefined {
  const s = typeof out === "string" ? out : JSON.stringify(out ?? "");
  const m = s.match(/\d+\.\d+\.\d+@\d+\.\d+/);
  return m?.[0];
}
