# @agentrouter/provider

Inference supply: an OpenAI-compatible server that sells inference per request behind an
x402 USDC paywall (native HBAR via `SETTLEMENT_ASSET=hbar`), registers on the HCS registry topic,
and stakes a 50 ℏ bond to escrow on boot. Pluggable compute backends: **0G Compute** (default for
bring-your-own supply), **Groq**, or a **canned** offline fallback.

One codebase, five env-driven profiles: `provider1`–`provider4` are the demo personalities
(including the cheater the verifier catches), and **`custom` is the one you use to list your
own compute** — `pnpm provider`, configured entirely from `.env`, no code edits. ("Your own
compute" = you pick the model, price, and backend; the inference comes from the backend you
point at — 0G/Groq/canned — not from a local GPU.)

## Listing your own compute

```bash
pnpm provider     # == --profile custom, reads PROVIDER_NAME / PROVIDER_MODEL / PROVIDER_PRICE
```

Two things make this easier than reading the whole runbook:

- **Guided setup** — the [`onboarding-a-provider`](../../.claude/skills/onboarding-a-provider/SKILL.md)
  skill walks the zero-to-live path with you and verifies each step on-chain rather than
  trusting the logs. It works with plain `pnpm` commands; the MCP tools below are optional.
- **Callable tools** — [`@agentrouter/provider-mcp`](../provider-mcp/README.md) exposes the
  Hedera work (create + fund the account, stake, HCS-14 registration, liveness check) as
  idempotent MCP tools. It does **not** replace `pnpm provider`: the service stakes and
  registers itself on boot, and the tools bootstrap the account beforehand and confirm
  you're routable afterwards.

The one rule either way: **`PROVIDER_PUBLIC_URL` must be in `.env`** and must be your public
address. Miss it and the service registers `http://localhost:<port>`, which the exchange
can't reach — you'll show up `down`.

Full documentation: [`docs/provider.md`](../../docs/provider.md).
