# AgentRouter — 3-Minute Demo Video Script

*Shooting script for the submission video. Recorded against the **hosted** stack (Vercel dashboard +
Railway services) on **real Hedera Testnet** — every transaction on screen is a real one.*

Narrative source: [DEVREL_BRIEF.md](DEVREL_BRIEF.md) · Runbook source: [DEPLOY.md](DEPLOY.md)

---

## The one argument this video has to land

Not "look at our features." This: **the cheating provider is the cheapest, so it wins all the traffic —
until it gets caught, and the market price goes *up*.**

Every beat before the slash exists to make the viewer root for the cheap price. The step from `$0.08` to
`$0.10` is the payoff, not a bug. If a beat doesn't set that up or pay it off, it gets cut.

---

## Beat sheet

| Time | Beat | Screen |
|---|---|---|
| 0:00–0:12 | Hook — the problem | Landing hero |
| 0:12–0:26 | What it is | Landing stats + `402` terminal |
| 0:26–1:00 | **Prompting** — the agent buys | `/agent-demo` |
| 1:00–1:26 | **Providers** — the market routes | `/exchange` registry + feed + index |
| 1:26–2:06 | **Slashing** — the climax | `/exchange` verifier log → banner → row → index |
| 2:06–2:26 | Payoff + on-chain proof | Price index → HCS verdicts → Hashscan |
| 2:26–2:41 | **0G Compute** | `/agent-demo` model picker → feed |
| 2:41–3:00 | **Skill + MCP** + close | `/providers` |

Narration totals **414 words**, paced beat-by-beat between **120 and 158 wpm** (measured per beat below).
No beat requires rushing; the two tightest are the payoff and the close, both written in short sentences
so the full stops carry the pace.

---

## Pre-flight — before you hit record

### 1. Confirm the cheater is armed

```bash
EX=https://exchange-production-275a.up.railway.app
curl -s $EX/providers | jq '[.[] | select(.status=="live")
  | {displayName, model, price, status, reputation, bondStatus}]'
```

**Pass condition — all four must hold:**

- `SketchyGPU Labs` → `live`, `price: 0.08`, `reputation: 100`, `bondStatus: "active"`
- `Titan Compute` → `live`, `price: 0.1` (the honest witness — no witness, no slash, ever)
- `NimbusAI` → `live`, `price: 0.06`
- Exactly **two** live providers claim `llama-3.3-70b-versatile`, and SketchyGPU is the cheaper one

**If SketchyGPU reads `slashed`**, it stays out of routing and the climax won't fire. Re-arm it per
[DEPLOY.md §"Re-arming the cheater"](DEPLOY.md): redeploy the **exchange** (clears in-memory slash state
and log), redeploy the **verifier** (clears its audited-wallet memory), then re-run the curl above.

### 2. Warm the market

The price index needs history to draw a flat `$0.08` line before it steps. Run the agent **twice** from
`/agent-demo` without recording — this also confirms the whole loop is alive. Warming may itself trigger
the slash; that's fine and expected. Re-arm (step 1) afterwards, then record.

### 2b. ⚠️ Use *hard* prompts — the audit is probabilistic

**The verifier does not catch the cheater every cycle.** Read the real verdict history off-chain:

```bash
curl -s "https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.9756367/messages?limit=25&order=desc" \
| python3 -c 'import sys,json,base64
for m in json.load(sys.stdin)["messages"]:
    p=json.loads(base64.b64decode(m["message"]))
    print(m["sequence_number"], p.get("verdict"), p.get("similarity"))'
```

At time of writing, 7 audits recorded on topic `0.0.9756367` split **4 fraud / 3 pass**:

| Verdict | Similarity | Outcome |
|---|---|---|
| `fraud` ×3 | `0.019` | caught — 2% vs a 35% threshold |
| `fraud` ×1 | `0.25` | caught |
| `ok` ×2 | `0.5` | **missed** |
| `ok` ×1 | `1.0` | **missed** |

This is the honest limitation the project already documents under *"Can a cheater beat the verifier?"* in
[DEVREL_BRIEF.md](DEVREL_BRIEF.md): on **short, simple prompts an 8B and a 70B model answer nearly
identically**, so similarity stays above threshold and the audit passes. Note this also means the
brief's "we measured 0–7%" is the *caught* tail, not the whole distribution — don't quote 0–7% as if
every audit produces it.

**What this means for the shoot:**

- Drive traffic with **long, comparative, multi-part** goals. `Compare the top 3 L1s by throughput and
  fees` diverges hard. `What is Ethereum?` does not — it's the kind of prompt that produces a `1.0`.
- Budget **2–4 audit cycles (30–60s)**, not one, for the slash to land. Record the wait; cut it later.
- Queue several agent runs back to back before the climax beat so the verifier has a deep pool of
  divergent 70B requests to sample from.
- If three cycles pass with `ok` verdicts, stop, run one more long-goal agent run, and wait again.

### 3. Screen setup

- Browser 1440×900, **zoom 100%**, dark mode, bookmarks bar hidden
- Two tabs pre-opened so no address-bar typing appears on camera:
  `…vercel.app/agent-demo` and `…vercel.app/exchange`
- **Do not** append `?api=` — the default hosted backends are what you want
- Have `hashscan.io/testnet/topic/0.0.9756367` (verdicts) ready in a third tab as a fallback

### 4. Live coordinates (verify these resolve before shooting)

| Thing | Value |
|---|---|
| Dashboard | `https://eth-global-lisbon-2026-dashboard.vercel.app` |
| Exchange API | `https://exchange-production-275a.up.railway.app` |
| Agent server | `https://agent-server-production-6029.up.railway.app` |
| Agent identity | `uaid:aid:hedera:testnet:0.0.9755656` |
| HCS registry / trades / **verdicts** | `0.0.9756362` / `0.0.9756366` / **`0.0.9756367`** |
| ReputationBond (ARBOND) | `0.0.9758338` |

---

## The script

### 0:00 – 0:12 · Hook — the problem  *(28 words · 140 wpm)*

**Screen:** Landing page `/`. Slow push in on the hero. Do not scroll yet.

> Every time you call an LLM API, you trust the provider is running the model you paid for.
>
> Nobody checks.
>
> So the cheapest fraud wins the routing war.

**Notes**
- Land hard on the last line, then a half-beat of silence before the cut.
- Hold on the hero *visually* only. **Do not read the subhead** ("Low latency… Infinite scale") — see
  [Guardrails](#guardrails--do-not-say-do-not-click).

---

### 0:12 – 0:26 · What it is  *(31 words · 133 wpm)*

**Screen:** Scroll down past the live stat cards (**Total Volume · Requests Served · Providers Live ·
Avg Price** — real numbers off the hosted exchange), then land on the `provision.sh` terminal block and
hold on the red `HTTP/1.1 402 Payment Required`.

> AgentRouter is an on-chain OpenRouter. AI agents buy inference one request at a time, in USDC, on
> Hedera.
>
> No accounts. No API keys. No subscriptions. Just HTTP 402 — Payment Required.

**Notes**
- The 402 block is the money shot of this beat — time the scroll so it lands under "Payment Required."
- Scroll **past** the Network Integrity marquee without pausing (dead links — see Guardrails).

---

### 0:26 – 1:00 · Prompting — the agent buys  *(68 words · 120 wpm)*

**Screen:** Cut to `/agent-demo`.

1. Hold 2s on the **HCS-14 AGENT IDENTITY** card (left sidebar) — the `uaid:aid:hedera:testnet:0.0.9755656`
2. Click the **Mission Control · Set a goal** input, type:
   `Compare the top 3 L1s by throughput and fees`
3. Leave the model picker on **`Auto (router)`**
4. Click **Run**
5. Follow the **LIVE REASONING STREAM**: the plan appears → a bought answer card renders with provider
   name, cost, and a **payment tx ↗** link
6. **Hover the payment tx link** (don't click — hold the cursor so the Hashscan URL shows in the status bar)
7. Cut to the **BUDGET** bar draining in the sidebar
8. Land on the cyan **Synthesis** block

> This is an autonomous buyer with its own on-chain identity — an HCS-14-style Universal Agent ID — and a
> two-dollar budget it controls itself.
>
> Give it a goal.
>
> It plans, then buys each answer through the exchange. Every purchase is a real x402 payment settled on
> Hedera Testnet. That link is the transaction, on Hashscan. Watch the budget drain.
>
> Then it synthesizes. No human approved a single payment.

**Notes**
- **Stretch line** if the stream is slow: *"Every one of these buys is a separate HTTP request, priced,
  paid, and settled on its own."*
- **Cut line** if it's fast: drop *"Then it synthesizes."*
- The **PREVIOUS CALLS** panel below is durable on-chain history read back from the agent's own HCS
  topic. Skip it unless you're under time — it's a nice-to-have, not a beat.

---

### 1:00 – 1:26 · Providers — the market routes  *(61 words · 141 wpm)*

**Screen:** Cut to `/exchange`.

1. **PROVIDER REGISTRY** table — pan across the three **live** rows: `Titan Compute` / `SketchyGPU Labs`
   / `NimbusAI`. Columns to catch: **Model · Price · Stake · Rep · Bond (`50 ARBOND · BONDED`) · Status**
2. Cut to **LIVE SETTLEMENT FEED** — rows streaming, every 70B row reading `SketchyGPU Labs`
3. Cut to **PRICE INDEX (¢/REQ)** — the cyan 70B line, flat at 8

> Here's the market it bought from. Every provider staked fifty HBAR and registered itself on a Hedera
> Consensus Service topic. The exchange routes each request to the cheapest provider claiming that model.
>
> Titan Compute serves llama-70B at ten cents. SketchyGPU Labs claims the same model — at eight.
>
> So SketchyGPU wins every 70B request. Look at the feed. Eight cents, flat.

**Notes**
- ⚠️ The table also carries **two stale `localhost` rows** marked `DOWN` (one showing `$0`). Frame the
  pan on the live rows and **don't rest the cursor on the dead ones**. If they're unavoidable in frame,
  ignore them — don't explain them.
- The caption under the chart — *"Watch the step when fraud exits the market"* — is a deliberate setup.
  Let it be readable for a beat. Don't read it aloud; it spoils the next beat.

---

### 1:26 – 2:06 · Slashing — the climax  *(95 words · 143 wpm)*

**Screen:**

1. Cut to the **VERIFIER AUDIT LOG** card (note the `THRESHOLD: 0.35` chip top-right) — `PASS` entries
   scrolling
2. **Hold** — wait for the red `VERDICT: FRAUD — Divergence vs witness Titan — similarity 2% < 35%`
3. The full-width red **`ALERT: PROVIDER SLASHED — SketchyGPU Labs — 25 ℏ seized`** banner fires at the
   top of the page
4. Cut to the registry table: SketchyGPU's row is red, `SLASHED` pill, stake cut, **Rep 0**, bond
   struck through → **`0 ARBOND · WIPED`**
5. Cut to the price index

> But SketchyGPU is lying. It advertises 70B, serves a cheap 8B model, and pockets the difference.
>
> So every fifteen seconds a verifier samples a past request and replays it — at temperature zero —
> against the accused, and against an honest witness on the same model. Same model, same prompt,
> near-identical answer. Different model, and the similarity collapses.
>
> Two percent. The threshold is thirty-five.
>
> That fires real transactions on Hedera. Twenty-five HBAR seized from escrow. The reputation bond
> destroyed by a two-of-two multi-signature token wipe. And SketchyGPU is out of routing.
>
> Now watch the price.

**Notes**
- ⏱ **This is the only beat with live timing risk, and it is a real one.** The verifier runs on a 15s
  interval *and* passes the cheater on easy prompts (see **Pre-flight §2b** above). Expect **2–4 cycles**.
  Do not plan a single continuous take across the wait — narrate up to "Different model, and the
  similarity collapses," then **pause recording** until the `VERDICT: FRAUD` line renders, and resume on
  "Two percent." The cut is invisible; a 45-second dead-air stare is not.
- **Stretch line** while waiting on camera: *"It's not a reputation score, and it's not a review. It's a
  measurement — and it's about to cost somebody money."*
- **If the banner is missed** (30s auto-hide), the registry row and the `WIPED` badge are permanent. Cut
  to them and pick up at "Twenty-five HBAR seized." Re-shoot the banner as B-roll after re-arming.
- **Read the number the run actually reports.** Observed fraud verdicts on topic `0.0.9756367` came in at
  `0.019` (→ "two percent") and `0.25` (→ "twenty-five percent — still under the threshold"). Both are
  true; only one is punchy. Don't burn the number into a caption before the take.

---

### 2:06 – 2:26 · Payoff + on-chain proof  *(50 words · 150 wpm)*

**Screen:**

1. Hold on the **price index stepping `$0.08 → $0.10`** — the cheap line ends, the honest one continues
2. Cut to the **on-chain audit trail** card → click the **VERDICTS** tab → raw HCS consensus JSON with
   `TOPIC: 0.0.9756367` and a `SEQ:`
3. Click **`EXPLORE TOPIC ON HASHSCAN →`** → Hashscan verdicts topic, messages listed

> It went up. That's the point.
>
> Eight cents was fraudulent — you were paying for 70B and getting 8B. Ten cents is the market pricing
> honestly for the first time. Verification doesn't make inference cheap. It makes the price *true*.
>
> And that isn't our claim. It's on the consensus log.

**Notes**
- *"Verification makes prices honest, not low"* is the second-best line in the project. Land it.
- ⚠️ Use **this** Hashscan link — the one inside the `/exchange` audit panel, which reads live topic IDs
  from the API. The **footer and homepage marquee links are stale** (see Guardrails).

---

### 2:26 – 2:41 · 0G Compute  *(31 words · 124 wpm)*

**Screen:** Back to `/agent-demo`.

1. Open the **model picker** dropdown — show the list, then select **`0gm-1.0-35b-a3b · $0.06`**
2. Type a short goal: `What is 0G, in one sentence?` → **Run**
3. Cut to `/exchange` **LIVE SETTLEMENT FEED** → the new **NimbusAI** row with its tx arrows

> Supply is pluggable. NimbusAI is a fourth provider reselling 0G Compute's decentralized GPU network —
> different model, different backend, same rails.
>
> Pin it, and it settles on-chain exactly like the rest.

**Notes**
- ⚠️ Say **"settles on-chain"** — the stake, the HCS registration carrying the 0G model id, and the trade
  are all real and on Testnet. The completion *text* currently comes from the deterministic fallback
  until `ZEROG_API_KEY` is funded (`packages/provider/src/backends/zerog.ts`). **Never claim 0G GPUs
  generated the words.**

---

### 2:41 – 3:00 · Skill + MCP + close  *(50 words · 158 wpm — the fastest beat; lean on the full stops)*

**Screen:** Cut to `/providers`.

1. Fast pan across the economics row: **$0.10 per request · 50 ℏ quality bond · 0G Compute backend ·
   HCS on-chain registry**
2. Scroll to the **MCP Tools** table — hold 3s on the six tool names
3. Land on the `provision_provider({...})` terminal block ending in `✓ provisioned — discoverable & live`
4. End card: **AgentRouter** wordmark + repo URL

> And joining the supply side is agent-native. An MCP server and a Claude skill take a developer from a
> fresh checkout to a live, staked, registered provider — account creation, staking, HCS registration,
> liveness checks, all callable as tools.
>
> An open market for inference. Where lying costs you money.
>
> AgentRouter.

**Notes**
- ⚠️ **Do not click or hover "Join the Provider Waitlist"** — it's a hardcoded personal `mailto:`.
- Scroll speed matters more than dwell time here. This is a "there's more" beat, not a tour.

---

## Guardrails — do not say, do not click

Everything in the narration is backed by the "What's real vs. what's mocked" table in
[DEVREL_BRIEF.md](DEVREL_BRIEF.md). These are the ways to accidentally break that.

| ✗ Don't | ✓ Instead | Why |
|---|---|---|
| Read the hero's *"Low latency. Zero trust. Infinite scale."* | Leave it as silent B-roll | No latency benchmark exists in this repo. [HEDERA_BOUNTIES.md](HEDERA_BOUNTIES.md) explicitly notes sub-second finality is a *Hedera network property, not a benchmark we ran* |
| *"0G generated this answer"* | *"settled on-chain through 0G-backed supply"* | Completion body is the canned fallback pending `ZEROG_API_KEY`; the on-chain legs are real |
| Click the **footer** or homepage **marquee** topic links | Use `EXPLORE TOPIC ON HASHSCAN →` inside `/exchange` | Footer/marquee hardcode a dead earlier topic generation (`0.0.9744593/4/5`); the panel reads live IDs from `/topics` |
| Show the waitlist button's destination | Pan past it | Hardcoded personal `mailto:` address |
| Call the 50 ℏ stake "fifty dollars" | Requests settle in **USDC**; stake and slash are **HBAR**; reputation is **ARBOND** | Three different units. [PROOF.md](PROOF.md)'s headline receipts are pre-USDC HBAR amounts |
| *"HCS-14 compliant"* | **"HCS-14-style"** | The repo's own deliberate hedge: it follows the UAID pattern and is interoperable, it is not a certified registry |
| *"a decentralized verifier network"* | *"a verifier"* | MVP verifier is trusted and singular. If asked, the honest answer is in the [Q&A](DEVREL_BRIEF.md#questions-shell-get-with-answers) |
| *"the verifier catches every cheat"* / quoting *"0–7% divergence"* as typical | *"randomly replays and samples"* — describe the mechanism, not a hit rate | On-chain verdicts run **4 fraud / 3 pass**; short prompts score 0.5–1.0 and pass. Overclaiming here is the one thing a judge can disprove from the public topic in thirty seconds |
| Improvise a business model | Say nothing | MVP has none. Don't invent one on camera |

---

## B-roll / cutaway bank

Six reusable shots. Capture these **separately after the main take** so an editor can re-cut without a
re-record — several are also the insurance policy if a live beat misfires.

| # | Shot | Where | Covers |
|---|---|---|---|
| 1 | `HTTP/1.1 402 Payment Required` terminal block | `/` — `provision.sh` block | Any x402 mention |
| 2 | `0 ARBOND · WIPED` badge, close crop | `/exchange` registry, slashed row | A missed SLASHED banner |
| 3 | Price index stepping $0.08 → $0.10 | `/exchange` price index card | The payoff — grab this every run |
| 4 | Raw HCS verdict JSON, `TOPIC:` + `SEQ:` visible | `/exchange` audit trail → VERDICTS | "It's on the consensus log" |
| 5 | Hashscan transaction page (slash tx) | `hashscan.io/testnet/topic/0.0.9756367` | On-chain proof |
| 6 | `provision_provider({...})` → `✓ provisioned` | `/providers` `#agent-onboarding` | MCP / skill outro |

**Bonus cutaway if you have time** — the visceral one. Side-by-side of the two answers to *"What is
x402?"*: SketchyGPU's 8B response, *"x402 is an HTTP error code for payments"* (wrong), next to Titan's
correct answer. It makes the fraud legible without any chart. Drop it under the 1:26 beat if the verdict
runs late.

---

## Fallback: recording locally

If the hosted stack is unreachable on the day, the same arc runs offline and the slash **always** fires
fresh — but the Hashscan links become mock refs, so beats 2:06–2:26 lose their proof.

```bash
pnpm demo        # terminal 1 — boots 4 providers + exchange + verifier + agent, narrates, slashes
pnpm dashboard   # terminal 2 → http://localhost:3000
```

Point the dashboard at local services with `NEXT_PUBLIC_EXCHANGE_URL=http://localhost:4100` and
`NEXT_PUBLIC_AGENT_URL=http://localhost:4200`, or open
`http://localhost:3000/exchange?api=http://localhost:4100`.

`pnpm demo`'s own terminal narration (`0/5` config → `1/5` providers → … → `⚡ SLASHED` → `6/6` 0G beat)
is a usable substitute A-roll for beats 1:00–2:41 if the UI is unavailable too.
