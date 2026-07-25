# Núria — SUPPLY: run a provider from zero

*You don't need to read the codebase. This page is everything.*

## What a provider is here

An HTTP server selling LLM inference per-request. It advertises a model and a price; the exchange routes buyers to the cheapest provider claiming the model they want. Payment arrives per request as HBAR via x402 (HTTP 402 → signed payment → 200). On boot it registers itself on the HCS registry topic and stakes 50 ℏ into escrow — that stake is what gets slashed if a provider lies about its model.

## Run one on any box (5 commands)

```bash
git clone <repo-url> && cd Inferit
pnpm install
cp .env.example .env        # then paste the HEDERA_PROVIDERn_ID/KEY lines Sahil gives you
pnpm provider1              # or provider2 / provider3
curl -s localhost:4021/info # sanity: name, model, priceHbar, wallet
```

`MOCK_MODE=true` in `.env` = no chain, runs anywhere instantly. `MOCK_MODE=false` = real HBAR paywall (needs the Hedera account keys, from `pnpm setup-hedera` on the funded machine or pasted from the team vault).

## The three built-in personalities

| Profile | Name | Advertises | Actually serves | Price | Port |
|---|---|---|---|---|---|
| `provider1` | Titan Compute | llama-3.3-70b-versatile | same (honest) | 0.10 ℏ | 4021 |
| `provider2` | Budget Inference Co | llama-3.1-8b-instant | same (honest) | 0.04 ℏ | 4022 |
| `provider3` | SketchyGPU Labs | llama-3.3-70b-versatile | **8b when `CHEAT_MODE=true`** | 0.08 ℏ | 4023 |

All three proxy Groq (set `GROQ_API_KEY`, free at console.groq.com/keys) or fall back to canned deterministic answers with no key — the demo works either way.

## What fires on boot (real mode — live, see PROOF.md for the actual txs)

1. **HCS registration:** the provider publishes a registration JSON (HCS-14 agent id, model, price, endpoint, `hcs14` profile block) to the registry topic. The exchange discovers it from the Mirror Node within ~1-5s.
2. **Staking:** a one-time 50 ℏ transfer (`STAKE_HBAR` env to change) from the provider account to the escrow account `0.0.9744157`. Cached locally so reboots don't re-stake.

## Add a 4th provider with a new model/price

1. Open [provider/src/profiles.ts](../provider/src/profiles.ts) — copy the `provider2` block, rename key/displayName, set `port: 4024`, `advertisedModel`/`actualModel` to any Groq model id, pick `priceHbar`.
2. Add `"provider4": "tsx --env-file=.env provider/src/index.ts --profile provider4"` to root `package.json` scripts.
3. Create a Hedera account for it (ask Sahil to add a role in `scripts/setup-hedera-accounts.ts` and re-run — it's idempotent) or reuse a spare.
4. `pnpm provider4`. Add its URL to the exchange's `PROVIDER_URLS` env (comma-separated) and it enters routing automatically.

## Demo trick: live price undercut

Prices come from the profile at boot. To demo the reroute: stop provider2, drop its `priceHbar` below the current winner's, restart it. Watch the exchange's next request route to the new cheapest — visible in the dashboard feed within one request.

## Optional: Ollama backend (real self-hosted supply)

`PROVIDER_BACKEND=ollama` + `OLLAMA_BASE_URL=http://localhost:11434` switches a provider from Groq to a local Ollama (`ollama pull llama3.2:3b` first). If Ollama is unreachable the provider falls back to canned responses rather than dying — a missing backend never blocks the demo. (**Not built yet** — this flag is the one pending item on the supply side; ping Sahil for status.)

## Health & troubleshooting

- `GET /healthz` → `{ok:true}` · `GET /info` → what the exchange sees
- Port in use: another profile is running — `pkill -f "profile provider1"`
- `Missing HEDERA_PROVIDER1_ID` → your `.env` lacks the account lines; get them from the team or run `pnpm setup-hedera` where the operator key lives
- Boot log says which facilitator rung answered; if both hosted facilitators are down, flip `MOCK_MODE=true` and keep demoing
