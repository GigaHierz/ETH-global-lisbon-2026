// SLICE-1 GATE (strict): against provider1's /v1/chat/completions —
//   1. unpaid curl → HTTP 402
//   2. paid retry (x402, HBAR on hedera:testnet) → HTTP 200 + Hashscan tx link
//   3. provider balance up by exactly the price, agent balance down by exactly the price
//   4. twice in a row
// MOCK_MODE=true runs the simulated version (402 without header, 200 with).

import {
  MOCK_MODE,
  MOCK_PAYMENT_HEADER,
  HEDERA_NETWORK,
  TINYBAR,
  hbarBalance,
  hederaAccount,
  hashscanTx,
  log,
} from "@agentrouter/shared";

const PROVIDER_URL = process.env.PROVIDER_URL || "http://localhost:4021";
const body = JSON.stringify({
  model: "llama-3.3-70b-versatile",
  messages: [{ role: "user", content: "What is the capital of Portugal? One sentence." }],
  temperature: 0,
});

async function unpaidMustBe402() {
  const unpaid = await fetch(`${PROVIDER_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  log("smoke", `without payment → HTTP ${unpaid.status} (expect 402)`);
  if (unpaid.status !== 402) throw new Error(`paywall missing! got ${unpaid.status}`);
}

async function main() {
  const info = await (await fetch(`${PROVIDER_URL}/info`)).json();
  log("smoke", `provider: ${info.displayName} | ${info.model} @ ${info.priceHbar} ℏ/req | wallet=${info.wallet}`);

  if (MOCK_MODE) {
    await unpaidMustBe402();
    const t0 = Date.now();
    const paid = await fetch(`${PROVIDER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", [MOCK_PAYMENT_HEADER]: String(info.priceHbar) },
      body,
    });
    const data = await paid.json();
    log("smoke", `PAID (mock ${info.priceHbar} ℏ) → HTTP ${paid.status} in ${Date.now() - t0}ms`);
    log("smoke", `answer: ${data.choices?.[0]?.message?.content}`);
    return;
  }

  // ---- real x402 on hedera:testnet ----
  const { x402Client, wrapFetchWithPayment, x402HTTPClient } = await import("@x402/fetch");
  const { ExactHederaScheme } = await import("@x402/hedera/exact/client");
  const { createClientHederaSigner } = await import("@x402/hedera");
  const { PrivateKey } = await import("@hiero-ledger/sdk");

  const agent = hederaAccount("AGENT");
  const signer = createClientHederaSigner(agent.id, PrivateKey.fromStringECDSA(agent.key), {
    network: HEDERA_NETWORK,
  });
  const client = new x402Client();
  client.register("hedera:*", new ExactHederaScheme(signer));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const httpClient = new x402HTTPClient(client);

  const price = Number(info.priceHbar);
  const links: string[] = [];

  for (let round = 1; round <= 2; round++) {
    log("smoke", `━━ round ${round}/2 ━━`);
    await unpaidMustBe402();

    const [agentBefore, providerBefore] = await Promise.all([
      hbarBalance(agent.id),
      hbarBalance(info.wallet),
    ]);
    log("smoke", `balances before: agent ${agentBefore.toFixed(4)} ℏ | provider ${providerBefore.toFixed(4)} ℏ`);

    const t0 = Date.now();
    const res = await fetchWithPayment(`${PROVIDER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (res.status !== 200) throw new Error(`paid retry failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    log("smoke", `PAID (x402 ${price} ℏ) → HTTP ${res.status} in ${Date.now() - t0}ms`);
    log("smoke", `answer: ${data.choices?.[0]?.message?.content}`);

    const receipt = httpClient.getPaymentSettleResponse((n: string) => res.headers.get(n)) as {
      transaction?: string;
      success?: boolean;
    };
    log("smoke", `settle receipt: ${JSON.stringify(receipt)}`);
    if (receipt?.transaction) {
      const link = hashscanTx(receipt.transaction);
      links.push(link);
      log("smoke", `🔗 HASHSCAN: ${link}`);
    }

    const [agentAfter, providerAfter] = await Promise.all([
      hbarBalance(agent.id),
      hbarBalance(info.wallet),
    ]);
    const agentDelta = agentBefore - agentAfter;
    const providerDelta = providerAfter - providerBefore;
    log(
      "smoke",
      `balances after:  agent ${agentAfter.toFixed(4)} ℏ (−${agentDelta.toFixed(4)}) | provider ${providerAfter.toFixed(4)} ℏ (+${providerDelta.toFixed(4)})`,
    );

    const tb = (x: number) => Math.round(x * TINYBAR);
    if (tb(providerDelta) !== tb(price)) throw new Error(`provider delta ${providerDelta} ≠ price ${price}`);
    if (tb(agentDelta) !== tb(price)) throw new Error(`agent delta ${agentDelta} ≠ price ${price} (fees should be facilitator-sponsored)`);
    log("smoke", `✓ round ${round}: provider +${price} ℏ exactly, agent −${price} ℏ exactly`);
  }

  log("smoke", `GATE PASSED — 2/2 settlements on ${HEDERA_NETWORK}`);
  for (const l of links) log("smoke", `  ${l}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
