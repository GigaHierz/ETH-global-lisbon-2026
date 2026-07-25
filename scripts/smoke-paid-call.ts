// SLICE-1 GATE (strict): against provider1's /v1/chat/completions —
//   1. unpaid curl → HTTP 402
//   2. paid retry (x402 on hedera:testnet) → HTTP 200 + Hashscan tx link
//   3. provider settlement balance up by exactly the price, agent's down by exactly it
//   4. agent's HBAR balance unchanged — settlement fees are facilitator-sponsored
//   5. twice in a row
// MOCK_MODE=true runs the simulated version (402 without header, 200 with).
//
// (3) and (4) are asserted separately on purpose. In USDC mode they check different
// things — the token moved, and gas didn't leak out of the payer — so collapsing them
// into one delta would report a sponsorship regression as a confusing price mismatch.

import {
  MOCK_MODE,
  MOCK_PAYMENT_HEADER,
  HEDERA_NETWORK,
  TINYBAR,
  DEFAULT_MODEL,
  PROVIDER_PORTS,
  ASSET_LABEL,
  money,
  SETTLEMENT_ASSET,
  USDC_DECIMALS,
  localhostUrl,
  hbarBalance,
  settlementBalance,
  hederaAccount,
  hashscanTx,
  log,
} from "@agentrouter/shared";

const PROVIDER_URL = process.env.PROVIDER_URL || localhostUrl(PROVIDER_PORTS[0]);
const body = JSON.stringify({
  model: DEFAULT_MODEL,
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

// Display precision: USDC is a 6-dp token but prices are cents-scale, so 4 dp reads
// well for both assets.
const DP = 4;

async function main() {
  const info = await (await fetch(`${PROVIDER_URL}/info`)).json();
  log("smoke", `provider: ${info.displayName} | ${info.model} @ ${money(info.price)}/req | wallet=${info.wallet}`);

  if (MOCK_MODE) {
    await unpaidMustBe402();
    const t0 = Date.now();
    const paid = await fetch(`${PROVIDER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", [MOCK_PAYMENT_HEADER]: String(info.price) },
      body,
    });
    const data = await paid.json();
    log("smoke", `PAID (mock ${money(info.price)}) → HTTP ${paid.status} in ${Date.now() - t0}ms`);
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

  const price = Number(info.price);
  const links: string[] = [];
  // Base-unit scale of the active asset: 10^8 tinybar per ℏ, 10^6 per USDC.
  const SCALE = SETTLEMENT_ASSET === "hbar" ? TINYBAR : 10 ** USDC_DECIMALS;
  const units = (x: number) => Math.round(x * SCALE);

  for (let round = 1; round <= 2; round++) {
    log("smoke", `━━ round ${round}/2 ━━`);
    await unpaidMustBe402();

    const [agentBefore, providerBefore, agentHbarBefore] = await Promise.all([
      settlementBalance(agent.id),
      settlementBalance(info.wallet),
      hbarBalance(agent.id),
    ]);
    log("smoke", `balances before: agent ${money(agentBefore.toFixed(DP))} | provider ${money(providerBefore.toFixed(DP))}`);

    const t0 = Date.now();
    const res = await fetchWithPayment(`${PROVIDER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (res.status !== 200) throw new Error(`paid retry failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    log("smoke", `PAID (x402 ${money(price)}) → HTTP ${res.status} in ${Date.now() - t0}ms`);
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

    const [agentAfter, providerAfter, agentHbarAfter] = await Promise.all([
      settlementBalance(agent.id),
      settlementBalance(info.wallet),
      hbarBalance(agent.id),
    ]);
    const agentDelta = agentBefore - agentAfter;
    const providerDelta = providerAfter - providerBefore;
    log(
      "smoke",
      `balances after:  agent ${money(agentAfter.toFixed(DP))} (−${agentDelta.toFixed(DP)}) | provider ${money(providerAfter.toFixed(DP))} (+${providerDelta.toFixed(DP)})`,
    );

    // Compare in the asset's own base units (tinybar / 6-dp USDC) so float noise in the
    // balance queries can't fail an otherwise exact settlement.
    if (units(providerDelta) !== units(price)) throw new Error(`provider delta ${providerDelta} ≠ price ${price}`);
    if (units(agentDelta) !== units(price)) throw new Error(`agent delta ${agentDelta} ≠ price ${price}`);

    // Separate assertion: the facilitator sponsors the transfer fee, so an HTS payment
    // must not cost the payer any HBAR. A leak here is a sponsorship regression, not a
    // pricing bug — hence its own message.
    const hbarDelta = agentHbarBefore - agentHbarAfter;
    if (SETTLEMENT_ASSET === "usdc" && Math.round(hbarDelta * TINYBAR) !== 0) {
      throw new Error(`agent paid ${hbarDelta} ℏ in fees — settlement fees should be facilitator-sponsored`);
    }
    log("smoke", `✓ round ${round}: provider +${money(price)} / agent −${money(price)} exactly, 0 ℏ fees`);
  }

  log("smoke", `GATE PASSED — 2/2 settlements on ${HEDERA_NETWORK}`);
  for (const l of links) log("smoke", `  ${l}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
