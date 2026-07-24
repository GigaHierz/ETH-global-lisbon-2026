# Team Prompts — one per person, paste into your AI tool

*Fri Jul 24 evening. Each section below is a complete, self-contained prompt: copy your whole section into Claude Code (or whatever you're driving) and let it build. The "Shared context" block is already baked into each prompt — no need to copy it separately.*

**Updated timeline:** work independently tonight/tomorrow morning → meet ~10:00 Saturday → focused work session → **Saturday evening: end-to-end working + first demo recording.** Only after that recording exists do we look at other sponsors or cool features.

**The simplicity rule (applies to everyone):** build the base flow and nothing else. Every time you think "it would be cool if…" — do NOT build it. Write one line in `FEATURES.md` in the repo root and move on. Tomorrow evening, after the recording, we pick from that list together.

**How to use these prompts (the flow you agreed):** Lena reviews this doc first → she sets up the shared plumbing (checklist below) → then each of you pastes your section into Claude and builds. Your Claude gets the full picture from the prompt itself — what the whole product is, what the other two are building, and exactly where your piece plugs in — so you don't need to explain anything extra.

**One clarification from tonight's talk:** the VPS does **not** need OpenClaw. The server side is just **Ollama** (the program that runs DeepSeek and serves it over HTTP) plus our thin payment wrapper. OpenClaw/Hermes is agent-side tooling — if it appears anywhere, it's in Person C's buyer agent, not on the server.

**Install Hedera's hackathon helper (all three of you, before starting):** Hedera ships official Claude Code skills at [github.com/hedera-dev/hedera-skills](https://github.com/hedera-dev/hedera-skills). In Claude Code run `/plugin marketplace add hedera-dev/hedera-skills`, then install what fits your part: `agent-kit-plugin` and `native-services-js` for Persons A and C (Agent Kit, Token/Consensus Service guides), and Lena additionally `hackathon-prd` and — before submitting Sunday — `validate-submission`, which scores the repo against Hedera's actual 7 judging criteria. Hedera also runs a hosted Agent Kit MCP server (see their Agent Lab at dev.portal.hedera.com/agent-lab) — useful for balance/token lookups without local setup.

**The win condition (agreed tonight):** the demo that wins is not one payment — it's **x402 micropayments firing over and over on testnet**, agents buying inference again and again while the trade feed scrolls and earnings counters spin. One successful payment validates the idea; a stream of them *demonstrates* it. Everything below is built to make that repetition easy and visible.

## Lena — setup & review checklist (before anyone starts)

1. Create the GitHub repo (yes, GitHub is required — it's how Saturday-evening integration works, and judges look at commit history). Folders: `provider/`, `exchange/`, `agent/`, plus `FEATURES.md` and `.env.example` at root. Add both teammates as collaborators.
2. Create the shared Hedera pieces: one testnet account per person + one per demo agent (portal.hedera.com faucet), and one HCS topic. Put the topic ID and account IDs in `.env.example` (never commit private keys — each person keeps their own `.env`).
3. VPS: one Hostinger VPS (~€10/mo, split three ways) — pick a plan with enough RAM for an 8B model (16 GB comfortable, 8 GB minimum with a quantized model).
4. Review the three prompts below — especially the frozen message formats, since every component depends on them exactly. Adjust if needed, *then* everyone feeds their prompt into Claude.
5. During the build: you're the reviewer/integrator — merge to main, sanity-check pushes, and call the two Saturday standups.

---

## PROMPT A — Provider server (VPS person)

Copy from here ⬇️

You are helping me build one of three components of a 36-hour ETHGlobal Lisbon hackathon project. Keep everything as simple as possible — minimum viable, no extra features, no speculative abstractions. If you think of an improvement, add a one-line note to a file called FEATURES.md instead of building it.

PROJECT CONTEXT: We're building an open spot market for LLM inference. Providers (anyone running Ollama) list a model + price on an exchange; autonomous buyer agents discover the cheapest provider and pay per request using the x402 payment protocol (HTTP 402 flow) on Hedera testnet. Three components built by three people in parallel: (A) provider server — MY PART, (B) exchange board, (C) buyer agent. There is only a buyer agent — the provider server IS the seller side; it's not agent-to-agent.

LOCKED TECHNICAL DECISIONS (do not revisit): Hedera testnet for everything. Payments: x402 via Hedera Agent Kit V4's x402 reference implementation (its facilitator covers gas). Registry: a single Hedera Consensus Service (HCS) topic — listings and trade logs are JSON messages on that topic; no smart contracts. The topic ID and my testnet account credentials are in .env. Repo layout: provider/, exchange/, agent/ — I only work in provider/.

SHARED MESSAGE FORMATS (frozen — all three components depend on these exactly):
Listing message: {"type":"listing","provider":"titan-compute","model":"deepseek-r1:8b","price_per_1k_tokens":"0.002","currency":"USDC","endpoint":"http://<host>:8402/v1/chat/completions","wallet":"0.0.XXXXX","stake":"10"}
Trade message: {"type":"trade","provider":"titan-compute","buyer":"agent-1","tokens":812,"amount":"0.0016","ts":"<iso timestamp>"}

WHAT TO BUILD:
1. VPS setup script/instructions: install Ollama on my Hostinger VPS, pull deepseek-r1:8b and llama3.2:3b (one good model, one fast model — fast matters for a live demo).
2. A provider daemon (Node/TypeScript): an HTTP server on port 8402 that wraps Ollama's OpenAI-compatible endpoint (localhost:11434/v1/chat/completions). Per request: require x402 payment (respond 402 with payment details; on paid retry, verify via the Hedera facilitator), forward to Ollama, stream the completion back, then publish a trade message to the HCS topic. Price comes from a config file.
3. A `register` CLI command: publishes my listing message to the HCS topic.
4. A README so this exact setup runs on a teammate's laptop in ≤5 minutes (we demo a second provider undercutting my price live).

HOW TO TEST STANDALONE (don't wait for the other components): (a) curl the endpoint with no payment → expect 402 with correct payment instructions; (b) complete a paid request using a test wallet → expect a streamed completion; (c) after a request, verify the trade message appears on the topic via the mirror node: https://testnet.mirrornode.hedera.com/api/v1/topics/{topicId}/messages; (d) run `register` and verify the listing message appears there too.

DEFINITION OF DONE: a teammate who only knows my endpoint URL and the topic ID can pay and get a completion, and sees the listing + trades on the mirror node. NEVER mock or bypass the payment — judges verify real payments; a real payment on a small model beats anything fake.

Work step by step: get plain Ollama proxying working first, then add HCS publishing, then add the x402 payment gate last (it's the riskiest bit — we may pair on it as a team).

⬆️ Copy to here

---

## PROMPT B — Exchange board

Copy from here ⬇️

You are helping me build one of three components of a 36-hour ETHGlobal Lisbon hackathon project. Keep everything as simple as possible — minimum viable, no extra features, no speculative abstractions. If you think of an improvement, add a one-line note to a file called FEATURES.md instead of building it.

PROJECT CONTEXT: We're building an open spot market for LLM inference. Providers (anyone running Ollama) list a model + price; autonomous buyer agents discover the cheapest provider and pay per request via x402 on Hedera testnet. Three components built in parallel: (A) provider server, (B) exchange board — MY PART, (C) buyer agent. The exchange is read-only glue + UI: it does NOT broker payments (agents pay providers directly) and does NOT need accounts or a database beyond in-memory state.

LOCKED TECHNICAL DECISIONS (do not revisit): Hedera testnet. Registry: one Hedera Consensus Service (HCS) topic; listings and trades are JSON messages on it. I read the topic via the public mirror node REST API: https://testnet.mirrornode.hedera.com/api/v1/topics/{topicId}/messages (poll every few seconds; messages are base64-encoded). Topic ID in .env. Repo layout: provider/, exchange/, agent/ — I only work in exchange/.

SHARED MESSAGE FORMATS (frozen):
Listing: {"type":"listing","provider":"titan-compute","model":"deepseek-r1:8b","price_per_1k_tokens":"0.002","currency":"USDC","endpoint":"http://<host>:8402/v1/chat/completions","wallet":"0.0.XXXXX","stake":"10"}
Trade: {"type":"trade","provider":"titan-compute","buyer":"agent-1","tokens":812,"amount":"0.0016","ts":"<iso timestamp>"}
A newer listing from the same provider name replaces its older one (that's how price changes work).

WHAT TO BUILD (one Next.js app):
1. Indexer: poll the mirror node, decode messages, maintain in-memory state: current providers (latest listing per provider name) and a trade history.
2. The board UI — this is what judges stare at for the whole 3-minute demo, so make it look sharp: (a) provider table: name, model, price per 1k tokens, stake, endpoint status; (b) live trade feed (newest on top, animate new entries in); (c) per-provider EARNINGS COUNTER that visibly ticks up when a trade lands — this is the money shot; (d) when a provider changes price, highlight the change briefly.
3. A tiny read API for the buyer agent: GET /api/providers returns the current listings as JSON.

HOW TO TEST STANDALONE (don't wait for the other components): write a small script that publishes fake listing and trade messages to the HCS topic (hedera SDK, testnet account in .env) — two fake providers, one occasionally changing price, trades arriving every few seconds. The board must look demo-ready running purely on this fake feed. Also test a RAPID burst — several trades per second for a minute — because the real demo is agents spamming micropayments, and the feed and earnings counters must stay smooth and legible under that load, not choke or blur.

DEFINITION OF DONE: with the fake feed running, a stranger watching the screen for 30 seconds understands: these are sellers, these are their prices, money is flowing. GET /api/providers returns correct current listings.

Work step by step: mirror-node polling + decoding first, then the plain table, then the feed + earnings animation, styling last.

⬆️ Copy to here

---

## PROMPT C — Buyer agent

Copy from here ⬇️

You are helping me build one of three components of a 36-hour ETHGlobal Lisbon hackathon project. Keep everything as simple as possible — minimum viable, no extra features, no speculative abstractions. If you think of an improvement, add a one-line note to a file called FEATURES.md instead of building it.

PROJECT CONTEXT: We're building an open spot market for LLM inference. Providers (anyone running Ollama) list a model + price on an exchange; my component is the BUYER AGENT — an autonomous agent that needs LLM inference to do its work, and buys it on the open market instead of having an API key. There is no seller agent: the provider's server is the seller side. Three components built in parallel: (A) provider server, (B) exchange board, (C) buyer agent — MY PART. We previously ran agents on Hermes — reuse that setup where it helps.

LOCKED TECHNICAL DECISIONS (do not revisit): Hedera testnet. Payments: x402 via Hedera Agent Kit V4's x402 reference implementation (facilitator covers gas) — my agent holds a testnet wallet and pays per request. Discovery: read current listings either from the exchange's GET /api/providers or directly from the HCS topic via the mirror node (https://testnet.mirrornode.hedera.com/api/v1/topics/{topicId}/messages — support both, prefer the mirror node so we can say "agents don't even need our API"). Topic ID + wallet credentials in .env. Repo layout: provider/, exchange/, agent/ — I only work in agent/.

SHARED MESSAGE FORMATS (frozen):
Listing: {"type":"listing","provider":"titan-compute","model":"deepseek-r1:8b","price_per_1k_tokens":"0.002","currency":"USDC","endpoint":"http://<host>:8402/v1/chat/completions","wallet":"0.0.XXXXX","stake":"10"}
The provider endpoint speaks OpenAI-compatible chat completions, gated by x402: first call returns 402 with payment instructions; pay, retry with payment proof, get a streamed completion.

WHAT TO BUILD (Node/TypeScript CLI):
1. Agent loop: takes a config {name, task (a prompt), budget, model_preference}. Flow: fetch listings → filter to models it can use → rank by price ascending → call cheapest endpoint → handle the 402 → pay via the Hedera facilitator → retry with proof → stream the completion to stdout → record spend → re-fetch listings before the NEXT request (this re-check is what makes the live undercutting demo work — when a cheaper provider appears, the very next request must route there) → repeat until budget exhausted or task done.
2. Cloneable by config: `agent run configs/agent-1.json` — ship 3 example configs with different names/budgets/model preferences so we can run several buyers at once on demo day.
2b. BURST MODE (this is our win condition): a `--burst N` flag that splits the task into N small sequential requests (or repeats a small task N times), so one agent fires many x402 micropayments in quick succession. The demo's success metric is payments visibly firing over and over on testnet — design the loop so back-to-back payment rounds are fast (keep the wallet/facilitator session warm between requests; use the small fast model).
3. Clear log lines per decision, e.g.: "agent-1: 2 providers for deepseek-r1:8b — titan@0.002, laptop@0.0015 → choosing laptop" and "agent-1: paid 0.0016 USDC, budget left 0.91". These logs are demo material.

HOW TO TEST STANDALONE (don't wait for the other components): build a fake provider first — a ~30-line local server that returns a hardcoded 402 payment demand, accepts the paid retry, and streams a canned completion — plus a script publishing fake listings to the HCS topic at different prices. Test: agent picks the cheapest; mid-run, publish a cheaper listing and verify the next request switches provider.

DEFINITION OF DONE: `agent run configs/agent-1.json` against the fakes: discovers, ranks, pays (real x402 flow, even against the fake), streams a completion, respects its budget, and switches providers when undercut. NEVER mock the payment logic itself — judges check.

Work step by step: discovery + ranking against fake listings first, then the fake provider + completion streaming, then the real x402 payment last (riskiest bit — we may pair on it as a team).

⬆️ Copy to here

---

## FEATURES.md starter (drop in repo root)

```
# Feature parking lot — write it here, don't build it
# After Saturday evening's recording we pick from this list together.
# Format: - [who] one line — why it's cool / which sponsor track it hits
- [example] World ID human-backing gate on provider registration — $8k AgentKit track, our best prize fit
- [example] ENS name per provider with listing in text records — ENS AI-agent track (requires Sunday-morning booth presentation)
- [example] Stake slashing via checker agent that re-runs sampled prompts
- [example] Dynamic pricing / auctions instead of flat listings
```