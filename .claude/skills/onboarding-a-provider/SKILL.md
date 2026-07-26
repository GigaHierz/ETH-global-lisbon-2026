---
name: onboarding-a-provider
description: Use when a developer wants to run, list, register, or sign up their own inference provider on AgentRouter — sell LLM inference, list my compute/GPU, become a provider, earn USDC or HBAR per request, stake and register on Hedera, serve paid x402 completions. Guides and verifies the zero-to-live setup.
---

# Onboarding a Provider

## Overview

Walk a would-be provider from a fresh checkout to a **live, registered, payment-serving provider** on AgentRouter, verifying each step on-chain instead of trusting the logs. A provider is an HTTP server that sells LLM inference: it stakes 50 ℏ, registers an HCS-14 identity on the Hedera Consensus Service, and gets paid per request over x402. Settlement is **USDC** by default (`SETTLEMENT_ASSET=hbar` switches to native HBAR); the 50 ℏ quality bond is always HBAR either way.

**Do the setup WITH the user, one step at a time. After every step, run the verification and show the result before moving on.** Don't dump all the commands at once.

**REQUIRED:** the marketplace side (an exchange, and at least one other provider serving the same model as a verification witness) must be reachable. Locally that's `pnpm exchange` + `pnpm demo`; in production it's the hosted exchange URL.

This repo also ships an MCP server (`packages/provider-mcp`) whose tools automate the account, the stake, the HCS registration and the liveness check. **It does not replace `pnpm provider`** — the service stakes and registers itself on boot. The steps below are the same either way; the MCP just does some of them for you.

## The one rule that must never break

**Never print, echo, or paste the value of any private key** (`HEDERA_PROVIDER_KEY`, `HEDERA_OPERATOR_KEY`, etc.). Check that a key is *present*, never what it *is*:

```bash
grep -q '^HEDERA_PROVIDER_KEY=.\+' .env && echo "key present" || echo "MISSING"
```

**Never open `.env` whole** — no `cat`, no `Read`, no `grep` without `-q`. It holds the provider and operator keys, and pulling it into the transcript leaks them just as surely as printing one. Every check in this skill is a quiet `grep -q` for that reason; keep it that way when debugging.

This covers tool output too. Summarize tool results; don't dump them blindly. `deploy_provider` deliberately returns `"<set-as-railway-secret>"` placeholders in its `railwayConfig` — **relay them as placeholders**, never helpfully substitute the real value when showing the config to the user.

## Step 0 — which tools do you have?

Look at your own available tool list for a tool named `provision_provider` (it surfaces as `mcp__agentrouter-provider__provision_provider`).

- **You can see it** → the MCP server is connected. Follow the **With MCP** line inside each step.
- **You cannot see it** → it is not connected, and nothing is missing. The `pnpm` commands below are the complete, supported path. Do the setup with them.

Rules, no exceptions:

- The tool list is the only evidence. Never conclude the server is connected because this skill, a README, or a `.mcp.json` file mentions it.
- Never call an `mcp__agentrouter-provider__*` tool "to see if it works", and never describe a tool call you did not actually make.
- If a call comes back "no such tool", stop guessing at names — fall back to the `pnpm` commands and tell the user the server is not connected.

If the user wants the tools, read [references/mcp-setup.md](references/mcp-setup.md) and walk them through it.

## Steps (verify each before continuing)

### 1. Prerequisites
- **Node 22+** and **pnpm**: `node -v` (≥22), `pnpm -v`. (On Windows, `pnpm` may be blocked by the PowerShell execution policy — use `pnpm.cmd`.)
- **Repo cloned + installed**: run `pnpm install` in the repo root.
- **A reachable public URL, up now** — a tunnel (`cloudflared tunnel`, `ngrok`) or a VPS/cloud hostname. The exchange routes requests to the address you register, so `localhost` only works if the exchange runs on the same box. You need this URL at step 3, not at the end.
- **Run every `pnpm` command from the repo root.** The provider service resolves its `.registry-cache.json` against the current directory; from a subdirectory it can't see that you already staked, and it will stake another 50 ℏ. This is the precondition for every "it's idempotent, just re-run" claim below.
- **The other half of the market, running.** You need an exchange to route to you and a witness provider serving your model. Locally: `pnpm exchange` (or `pnpm demo`, which starts the exchange plus the demo providers) in a second terminal. Note its base URL — that's the `<EXCHANGE_URL>` used in steps 5 and 6; locally it's `http://localhost:4100`. Without it, step 6 fails for reasons that have nothing to do with your provider.

### 2. Hedera account
The provider account stakes, registers, and receives payment. Either:
- Run `pnpm setup-hedera` (needs a funded testnet operator in `.env` from portal.hedera.com) — it writes `HEDERA_PROVIDER_ID`/`HEDERA_PROVIDER_KEY`, or
- Paste an existing testnet account into those two vars.

**With MCP:** `create_provider_account({ role: "PROVIDER" })` — creates, funds, and writes the same vars. It returns `alreadyExisted: true` if the account is already there, which is a pass, not a skip.

**Verify (presence only):**
```bash
grep -q '^HEDERA_PROVIDER_ID=0\.0\.' .env && grep -q '^HEDERA_PROVIDER_KEY=.\+' .env && echo "account configured" || echo "run pnpm setup-hedera"
```
If the boot later says `Missing HEDERA_PROVIDER_*`, this step wasn't done.

### 3. Advertise a model, a price, and your public URL
Set these in `.env` (the `custom` profile reads them — no code edits):
- `PROVIDER_NAME` — shown in the routing table.
- `PROVIDER_MODEL` — a model id you can actually serve on your backend. **You must serve what you advertise** (see Guardrails).
- `PROVIDER_PRICE` — your price per request, denominated in the settlement asset (**USDC** by default; `SETTLEMENT_ASSET=hbar` switches the whole system to HBAR). The exchange routes the *cheapest* live provider for a model, so price to win the traffic you want.
- `PROVIDER_PUBLIC_URL` — your step-1 URL.
- `PROVIDER_BACKEND` — where inference actually comes from: `0g` (0G Compute, the default for bring-your-own supply, needs `ZEROG_API_KEY`), `groq` (needs `GROQ_API_KEY`), or `canned`. Omit the backend's key and you fall back to deterministic **canned** answers — fine for testing, and still honest about the advertised model.

**`PROVIDER_PUBLIC_URL` must be in `.env`** — not just exported in your shell, and not just known to the MCP server. `pnpm provider` reads `.env` at process start, in whatever shell you launch it from. If it's missing there, the service falls back to `http://localhost:4025` and the exchange can't reach you.

**Gate — do not continue until this prints `ready`.** It rejects localhost on purpose: a localhost value is what makes the exchange mark you `down`, and it would otherwise sail through a "is it set?" check.
```bash
grep -qE '^PROVIDER_PUBLIC_URL=https?://(localhost|127\.0\.0\.1|\[::1\])([:/]|$)' .env \
  && echo "PROVIDER_PUBLIC_URL is localhost — the exchange can't reach that" \
  || { grep -qE '^PROVIDER_PUBLIC_URL=https?://.+' .env && echo ready || echo "set PROVIDER_PUBLIC_URL in .env first"; }
```
(Only exception: you're testing with the exchange on this same machine.)

### 4. Boot + stake + register
```bash
pnpm provider          # from the repo root; profile "custom" reads the vars above
```
On boot it transfers `STAKE_HBAR` (50 ℏ — always HBAR, whatever the settlement asset) to the escrow account and publishes its registration to the HCS registry topic. **Booting the service is what performs the first stake and registration** — the MCP tools don't replace it. (On a remote box the same is true of `pnpm provider:prod`; see the remote-deploy section.)

**It binds the port first and registers in the background**, deliberately: a slow on-chain call before `listen` would leave the platform staring at a service that never answers. So `/healthz` starts returning `{"ok":true}` *before* the stake and registration have landed. Two consequences worth holding on to:

- A healthy `/healthz` is not evidence of registration. Wait for the two Hashscan lines below before moving on.
- If registration fails, the service keeps serving and logs `REGISTRATION FAILED` — it does not exit. Read the boot log; don't infer success from the process still running.

**Verify the two on-chain actions from the boot log** — it prints real Hashscan links:
- `staked 50 ℏ → escrow: https://hashscan.io/testnet/transaction/...`
- `registered on HCS registry topic (<your-url>): https://hashscan.io/testnet/transaction/...`

Then confirm the service answers (`4025` throughout is the default `PROVIDER_PORT` — substitute yours if you changed it):
```bash
curl -s localhost:4025/healthz     # {"ok":true}
curl -s localhost:4025/info        # displayName, model, price, wallet, agentId, url
```
`/info.url` MUST be your public URL, not localhost (or the exchange can't reach you).

### 5. Attach and confirm the registration (MCP only)
Skip this step entirely if the tools aren't available — step 4 already registered you.

**Never call `provision_provider` before `pnpm provider` is running.** It health-checks a live endpoint, so before boot it can only fail.

**And don't race it.** The service registers in the background *after* the port opens, so a green `/healthz` doesn't mean registration is done. Calling the MCP straight away means two registrations in flight for the same account, and one wasted HCS message. Wait for step 4's `registered on HCS registry topic` line, then call it **once**:

```
provision_provider({ name: "<PROVIDER_NAME>", publicUrl: "<your URL>",
                     model: "<PROVIDER_MODEL>", price: <your price>,
                     exchangeUrl: "<EXCHANGE_URL>" })
```

Every mutating step self-skips — the account exists, the stake is cached, the registration matches — so it degenerates cleanly into health-check + verify. Use the orchestrator as a post-boot verifier, not a bootstrapper. (`deploy_provider` then `register_provider` individually does the same thing if you want the steps separately.)

That self-skipping depends on `.registry-cache.json` being the *same file* the provider service uses — repo root, with `AGENTROUTER_ENV_PATH` unset. If they diverge, "re-run, it's idempotent" stakes another 50 ℏ.

**Read `alreadyRegistered` in the result.** It should be `true`. If it's `false`, the step-3 gate was skipped: the service registered `localhost` and you are now overwriting it. Fix `.env`, restart `pnpm provider`, and re-check.

**Deploying to a remote box instead of a tunnel?** See "Deploying to a remote box" below — the order changes, and getting it wrong costs 50 ℏ.

### 6. Verify it's live and serving paid requests

A tool result is a claim. The Hashscan link, the routing-table row, and the `402` are the evidence — check those, not the summary line. Mirror Node lag is **1–5 s**, so give discovery a beat before you start.

**a. In the exchange routing table** — poll until your row shows `status: "live"`. The exchange keys the table by **URL**, so if you've ever changed endpoint your wallet has more than one row and the stale ones sit there as `down`. Print them all rather than trusting the first:
```bash
curl -s <EXCHANGE_URL>/providers | node -e '
  const w = process.argv[1];
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    const rows = JSON.parse(s).filter(p => p.wallet === w);
    if (!rows.length) return console.log("not in the table yet");
    for (const r of rows) console.log(`${r.status.padEnd(7)} ${r.price}  ${r.displayName}  @ ${r.url}`);
  });' "<HEDERA_PROVIDER_ID>"
```
(Quote the placeholder — unquoted, `bash` reads `<...>` as a redirect.)
You want the row whose `@ <url>` is your current public URL to say `live`. Stale rows for old endpoints are harmless. If *your* row says `down`, the exchange has your registration but can't reach that URL — and if the URL is localhost, step 3 didn't take.

**With MCP:** `verify_provider_live({ exchangeUrl: "<EXCHANGE_URL>" })` polls the same table by wallet and reports the observed status when it isn't live yet.

**b. The paywall rejects unpaid requests** (proves x402 is armed):
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4025/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"<PROVIDER_MODEL>","messages":[{"role":"user","content":"hi"}]}'
# expect: 402
```

**c. A real paid request completes end-to-end.** The exchange is *itself* x402-gated — a bare `curl` to it returns 402, not a completion, because the caller has to pay too. So use a real payer. The bundled agent is one:
```bash
EXCHANGE_URL=<EXCHANGE_URL> pnpm agent
```
If you're the cheapest live provider for the model, it routes to you:
```
[agent] → <PROVIDER_NAME> | price 0.05 + fee 0.005 = 0.055 ℏ | spent 0.0550 ℏ | 6543ms
```
Then confirm the settlement is real, not mocked:
```bash
curl -s <EXCHANGE_URL>/log | node -e '
  let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
    for (const e of JSON.parse(s).filter(e=>e.provider===process.argv[1]))
      console.log(`${e.price} + ${e.fee} fee -> ${e.paymentRef}`);
  });' "<PROVIDER_NAME>"
```
`paymentRef` must be a Hedera tx id (`0.0.x@secs.nanos`) — look it up at `https://hashscan.io/testnet/transaction/<paymentRef>`. Your name plus a settled tx is the acceptance bar: **402 → paid → completion**, on-chain.

## Deploying to a remote box (Railway/VPS) instead of a tunnel

Same steps, one reordering — and one rule that costs 50 ℏ if you break it.

**Never stake from your laptop for a box that will run elsewhere.** The stake is only skipped when `.registry-cache.json` says it already happened, and that file is local. A fresh container starts with an empty filesystem, sees no cached stake, and stakes a *second* 50 ℏ on boot. So let the box do its own staking — it will, on its first boot, exactly like step 4.

1. Steps 1–3 as written, except the public URL is the address the box *will* have. Set it in `.env` and pass the step-3 gate.
2. **With MCP:** `create_provider_account`, then `deploy_provider({ publicUrl: "<planned URL>" })`. The endpoint isn't up yet, so this reports `ENDPOINT_UNREACHABLE` — that is the expected result here, not a failure. It still returns the `railwayConfig` you need, and it stakes nothing. **Don't call `provision_provider` yet**; it would stake locally.
3. Deploy with that config (it sets `PROVIDER_PROFILE`, runs `pnpm provider:prod`, and expects the key as a platform secret). Watch the boot log for the same two Hashscan links as step 4 — the deployed service stakes and registers itself.
4. Now run steps 5 and 6 against the deployed URL. `provision_provider` is safe from here on: the stake is done and on the box.

## Play-fair guardrails (avoid getting slashed)

The verifier samples routed requests, replays the prompt at temperature 0 against your provider **and a witness** claiming the same model, and compares. If the answers diverge (Jaccard similarity `< SIMILARITY_THRESHOLD`, default 0.35), it seizes your **50 ℏ stake to the treasury and ejects you from routing**.

- **Serve exactly what you advertise.** The `custom` profile sets `actualModel = advertisedModel`, so honest by construction — don't defeat that by proxying a cheaper model.
- **You're only audited when a witness exists** — another live provider serving the same `PROVIDER_MODEL`. Advertising a model nobody else serves means no verification *and* likely no comparison-based trust; pick a model the market already has.
- **Keep your endpoint reachable.** A provider that goes unreachable is marked `down` and dropped from routing (not slashed), but it earns nothing.
- **Never set `cheat`.** The MCP tools accept a `cheat` argument that only affects the returned Railway config, but `CHEAT_MODE=true` on a running provider is exactly what gets the 50 ℏ seized.

## Quick reference

| Var | Default | Purpose |
|---|---|---|
| `PROVIDER_NAME` | Custom Provider | Display name in the routing table |
| `PROVIDER_MODEL` | llama-3.3-70b-versatile | Model you advertise **and serve** |
| `PROVIDER_PRICE` | 0.10 | Your price per request in the settlement asset (cheapest wins routing) |
| `PROVIDER_PORT` | 4025 | Local listen port |
| `PROVIDER_PUBLIC_URL` | `http://localhost:<port>` | Address the exchange routes to (tunnel/VPS). **Set it in `.env`** — the default makes you unreachable |
| `HEDERA_PROVIDER_ID` / `_KEY` | from `pnpm setup-hedera` | Account that stakes, registers, earns |
| `GROQ_API_KEY` | — | Real inference; omit → canned answers |
| `STAKE_HBAR` | 50 | Boot-time stake to escrow |
| `MOCK_MODE` | false | `true` fakes identity and payment entirely — must be `false` to earn real HBAR |

## Common mistakes

| Symptom | Cause / fix |
|---|---|
| Exchange never shows the provider | Mirror lag (wait 1–5 s); `/healthz` down; `PROVIDER_PUBLIC_URL` is `localhost` but the exchange is on another box |
| Boot: `Missing HEDERA_PROVIDER_*` | Step 2 not done — `pnpm setup-hedera` or paste the account into `.env` |
| Routing table shows you `down` with a `localhost` URL | `PROVIDER_PUBLIC_URL` wasn't in `.env` when the service booted. Put it there, restart, re-verify |
| `provision_provider` → `ENDPOINT_UNREACHABLE` | Called before `pnpm provider` was running. Boot the service first, then re-run from the repo root. (Deploying remotely instead? That's the `requireEndpoint: false` case in step 5) |
| Staked 100 ℏ instead of 50 | You ran `pnpm provider` from a subdirectory, so it couldn't see the cached stake. Always run from the repo root — that's what makes re-runs safe |
| Paid request routes to someone else | You're not the cheapest live provider for that model — lower `PROVIDER_PRICE` |
| Registered but never audited | No witness — no other live provider serves your `PROVIDER_MODEL` |
| Nothing settles / 402 loops | `MOCK_MODE` must be `false` for real payments; the facilitator ladder must be reachable |
| Step 6 fails and the provider looks fine | No exchange running — that's step 1's last bullet, not a fault in your provider |
| The user asked for the MCP tools and they aren't there | Not a defect: onboarding works without them. If they want them, run `pnpm install` and check `/mcp` for a pending approval — see [references/mcp-setup.md](references/mcp-setup.md) |
