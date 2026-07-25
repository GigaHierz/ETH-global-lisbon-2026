# STATUS.md — AgentRouter, stop-and-report
*2026-07-25 · pre-UPDATE-1 implementation · awaiting go*

## 1 · Acceptance criteria (slices 1–6)

> No numbered criteria list was given originally; reporting against the six build slices from the execution rules. All PASS evidence below is from a **clean mock-mode run today** (`scratchpad/demo-clean.log`, reproduced with `rm -f .registry-cache.json && pnpm demo`).

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| 1 | One provider + one paid x402 call | **PASS (mock) / PARTIAL (chain)** | `scripts/smoke-paid-call.ts`; demo log: `routed → SketchyGPU Labs ($0.0015 … pay=mock-pay-ms07ryis-…)`. Real path is built on `@x402/*` v2.19 and the live facilitator answers our 402 challenges, but **no on-chain settlement has been executed** — wallets unfunded. No tx link exists yet. |
| 2 | Exchange cheapest-provider routing | **PASS** | Demo log 10:16:17–20: all 5 requests routed to cheapest 70b-claimant SketchyGPU at $0.0015; after slash, `routed → Titan Compute ($0.002)`. Code: `exchange/src/index.ts`, `discovery.ts`. |
| 3 | Dashboard (terminal UI, SSE feed, price index, SLASHED banner) | **PASS** | `dashboard/` (commit 9a707bb), verified in browser at slice 3: provider table, live request feed, price chart, red SLASHED banner all render from SSE. Not re-verified visually today (services now stopped). |
| 4 | Verifier + Staking.sol slash | **PASS (mock) / PARTIAL (chain)** | Log 10:16:26: `SketchyGPU Labs claims llama-3.3-70b-versatile but its answer diverges from witness Titan Compute (similarity 0% < 35%)` → `💀 SLASHED … -$25 stake` → removed from routing. `forge test`: **3/3 passing** (`test_stake_slash_flow`, `test_slash_caps_at_stake`, `test_only_verifier_slashes`). **Staking.sol is NOT deployed** — `deployments.json .staking = null`, blocked on funding. |
| 5 | Agent CLI + `pnpm demo` + README | **PASS** | Full narrated run: 5 paid calls, balance $1.0000 → $0.9925, slash beat, reroute, `DEMO COMPLETE`. `--spam N` in `agent/src/index.ts`. README has quickstart/mermaid/reset/not-in-MVP. |
| 6 | Optional: 0G-backed provider | **MISSING (optional)** | Never started. **Superseded by UPDATE 1** (ollama backend), which is also **MISSING** — zero ollama code exists (`grep -ri ollama` → no hits), no `PROVIDER_BACKEND` abstraction, no VPS README section. |

**Cross-cutting honesty notes**
- Everything demonstrated end-to-end is **MOCK_MODE**. Real-chain path: facilitator probed live ✅, official ERC-8004 registries verified via `eth_getCode` ✅, but no funded wallet → no settlement tx, no registration tx, no deployed Staking. There are **no explorer links to show yet** (and none possible until funding).
- **Hashscan/Hedera mismatch:** the brief asked for "Hashscan tx or topic link" — Hashscan is Hedera's explorer, but this build targets **Base Sepolia** per the original mission (explorer would be sepolia.basescan.org). Nothing was built on Hedera. Flagging in case the bounty target changed — say the word and see research bullet 5.
- Stale-state gotcha found today: a leftover `.registry-cache.json` makes a rerun start with provider3 pre-slashed (README reset covers it; demo should probably auto-clean on boot — 5-line fix, queued).

## 2 · git log --oneline (all commits)

```
d5cf0c4 DevRel briefing doc: narrative, demo beats, real-vs-mocked, anticipated Q&A, glossary
710ae91 slice 5: agent CLI (--spam), one-command pnpm demo orchestrator, README (quickstart, mermaid, not-in-MVP), .env.example
6a0c63d slice 4: Staking.sol (+tests), deploy script, verifier — temp-0 replay vs witness, Jaccard similarity, slash + ERC-8004 negative feedback, exchange removes cheater
9a707bb slice 3: dashboard — dark terminal UI, live SSE provider table + request feed + price index chart, SLASHED banner
7a371e1 slice 2: exchange — cheapest-provider routing, x402/mock payer, SSE feed, slash + verify-report endpoints
ac1d051 slice 1: provider with x402 paywall (real + mock) + Groq proxy + ERC-8004 self-registration; smoke test proves paid call
```

## 3 · RESEARCH.md in 5 bullets

1. **x402:** use scoped `@x402/*` v2.19.0 (current line, published 2026-07-17); unscoped `x402-express`/`x402-fetch` are legacy v1 — avoided. Server/client APIs verified from coinbase/x402 examples, not memory.
2. **Facilitator:** hosted `https://x402.org/facilitator` probed live; supports `exact` on `eip155:84532` (Base Sepolia), price format `"$0.002"`, settles in testnet USDC `0x036C…CF7e`.
3. **ERC-8004 testnet addresses: FOUND** — official reference deployments live on Base Sepolia: Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713` (both verified via `eth_getCode`; self-feedback reverts, so feedback is filed by the verifier wallet). ValidationRegistry: no published address → skipped.
4. **Groq:** OpenAI-compatible endpoint; models pinned to `llama-3.3-70b-versatile` vs `llama-3.1-8b-instant` (Groq no longer serves llama-3.2-1b; divergence at temp 0 still ~0–7%).
5. **x402-on-Hedera pattern: FOUND but unused** — the same hosted facilitator's `/supported` lists `{scheme:"exact", network:"hedera:testnet", feePayer:0.0.9185802}` (x402 v2). A Hedera port is a network-string + funded-HTS-USDC change on our side, but nothing in this repo touches Hedera today, and RESEARCH.md doesn't cover HCS topics.

## 4 · Blockers

| Blocker | Time burned | 20-min stub |
|---|---|---|
| Testnet funding (Base Sepolia ETH + USDC for 6 wallets) — human-gated faucets, so real-mode settlement, Staking deploy, and on-chain 8004 registration are all queued behind it | ~0 min (deferred by design; mock path built instead) | **Already built:** MOCK_MODE is the stub and it's first-class. Real mode stays a flip-of-env once someone funds the printed addresses. |
| Ollama backend (UPDATE 1) | 0 min (not started — stopped for this report) | If a reachable Ollama fights us: `PROVIDER_BACKEND=ollama` falls back to canned responses (already specced in UPDATE 1); interface will land regardless so a teammate VPS can join later without code changes. |
| None other. Nothing has burned >20 min blocked. | | |

## 5 · Next three actions (on your go)

1. **UPDATE 1 core:** extract `provider/src/backends/{groq,ollama}.ts` behind `PROVIDER_BACKEND` env; rewrite profiles (p1 ollama llama3.2:3b honest/premium, p2 groq llama-3.3-70b honest, p3 advertises llama3.2:3b serves llama3.2:1b when CHEAT_MODE=true); auto-fallback to canned when the backend is unreachable — demo path can never block.
2. **Verifier + demo retest:** verifier witness pairing now keys on advertised model (p3 vs p1 on llama3.2:3b); clean-run `pnpm demo` against a local Ollama if present, canned otherwise; add the `.registry-cache.json` auto-clean.
3. **README "Run a provider on any VPS in 5 commands"** (clone → env → install → `ollama pull` → pm2/docker start), written so a stranger can list supply from that section alone; then commit as slice 6.

**Waiting for your go before touching code.**
