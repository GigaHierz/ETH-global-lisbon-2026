// Slice-1 smoke test: make ONE paid call to provider1's /v1/chat/completions.
// MOCK_MODE=true  → simulated x402 (402 without payment header, 200 with).
// MOCK_MODE=false → real x402 payment (Base Sepolia USDC via hosted facilitator).

import {
  MOCK_MODE,
  MOCK_PAYMENT_HEADER,
  USDC_ADDRESS,
  erc20Abi,
  publicClient,
  log,
  requireEnv,
} from "@agentrouter/shared";
import { privateKeyToAccount } from "viem/accounts";
import { formatUnits } from "viem";

const PROVIDER_URL = process.env.PROVIDER_URL || "http://localhost:4021";
const body = JSON.stringify({
  model: "llama-3.3-70b-versatile",
  messages: [{ role: "user", content: "What is the capital of Portugal? One sentence." }],
  temperature: 0,
});

async function main() {
  const info = await (await fetch(`${PROVIDER_URL}/info`)).json();
  log("smoke", `provider: ${info.displayName} | ${info.model} @ $${info.priceUsd}/req | agentId=${info.agentId}`);

  if (MOCK_MODE) {
    // 1. prove the paywall exists
    const unpaid = await fetch(`${PROVIDER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    log("smoke", `without payment → HTTP ${unpaid.status} (expect 402)`);
    if (unpaid.status !== 402) throw new Error("paywall missing!");

    // 2. pay (mock) and get inference
    const t0 = Date.now();
    const paid = await fetch(`${PROVIDER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [MOCK_PAYMENT_HEADER]: String(info.priceUsd),
      },
      body,
    });
    const data = await paid.json();
    log("smoke", `PAID (mock $${info.priceUsd}) → HTTP ${paid.status} in ${Date.now() - t0}ms`);
    log("smoke", `answer: ${data.choices?.[0]?.message?.content}`);
    return;
  }

  // ---- real x402 ----
  const { x402Client, wrapFetchWithPayment, x402HTTPClient } = await import("@x402/fetch");
  const { ExactEvmScheme } = await import("@x402/evm/exact/client");
  const account = privateKeyToAccount(requireEnv("AGENT_PK") as `0x${string}`);
  const pc = publicClient();
  const bal = await pc.readContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
  });
  log("smoke", `payer ${account.address} USDC balance: ${formatUnits(bal, 6)}`);
  if (bal === 0n) {
    log("smoke", "No testnet USDC — fund via https://faucet.circle.com (Base Sepolia) and retry.");
    process.exit(1);
  }

  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(account));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const t0 = Date.now();
  const res = await fetchWithPayment(`${PROVIDER_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const data = await res.json();
  log("smoke", `PAID (x402 $${info.priceUsd}) → HTTP ${res.status} in ${Date.now() - t0}ms`);
  log("smoke", `answer: ${data.choices?.[0]?.message?.content}`);
  const receipt = new x402HTTPClient(client).getPaymentSettleResponse((n) => res.headers.get(n));
  log("smoke", `payment receipt: ${JSON.stringify(receipt)}`);
  const bal2 = await pc.readContract({
    address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account.address],
  });
  log("smoke", `USDC balance after: ${formatUnits(bal2, 6)} (spent ${formatUnits(bal - bal2, 6)})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
