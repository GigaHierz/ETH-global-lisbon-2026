# @agentrouter/provider

Inference supply: an OpenAI-compatible server that sells inference per request behind an
x402 USDC paywall (native HBAR via `SETTLEMENT_ASSET=hbar`), registers on the HCS registry topic,
and stakes a bond to escrow on boot. One codebase, four env-driven personalities (including the
cheater used in the demo). Pluggable compute backends: **0G Compute** (default for bring-your-own
supply), **Groq**, or a **canned** offline fallback.

Full documentation: [`docs/provider.md`](../../docs/provider.md).
