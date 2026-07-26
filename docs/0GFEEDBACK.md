# 0G Developer Feedback — AgentRouter (ETHGlobal Lisbon 2026)

Feedback from building **AgentRouter** — an inference marketplace where AI agents pay per LLM
request in USDC over x402, providers stake collateral and register on-chain identities, and a
verifier catches providers that lie about the model they serve. One provider personality
(NimbusAI / provider4) resells compute from the **0G Compute Network** on its own unique model id,
so it can't collide with the demo's Groq-pinned fraud-detection arc.

**Our setup:** plain HTTP against the 0G Compute Router (`router-api.0g.ai/v1/chat/completions`,
OpenAI-compatible) — no SDK dependency, by choice, since the Router already gives us provider
discovery, billing and failover for free. We filed the concrete, reproducible problems as issues
(below) and captured the rest as honest narrative — separating what worked, what caused friction,
and what wasn't 0G's fault, so the useful signal is easy to find.

---

## 🗂 Issues we filed on 0G repos

| # | Repo | Issue | What it's about |
|---|---|---|---|
| 1 | `0gfoundation/0g-agent-skills` | [#3](https://github.com/0gfoundation/0g-agent-skills/issues/3) | **Skills, examples and the CI validator all pin deprecated packages.** `@0glabs/0g-serving-broker` and `@0glabs/0g-ts-sdk` are deprecated on npm, but `ci/validate-sdk-versions.ts` hardcodes them as the canonical versions — so the check that's supposed to keep things consistent actively enforces the old names across 27 files, including every compute `SKILL.md`. |
| 2 | `0gfoundation/0g-doc` | [#345](https://github.com/0gfoundation/0g-doc/issues/345) | **Router docs don't link to how to verify a response.** The Router FAQ claims you can verify "out-of-band" that the model you asked for is the model that ran, but neither the Router overview nor its FAQ says how — that's on a separate Inference page (`ZG-Res-Key` header + `processResponse`). |

### Context: the SDK naming (for anyone confused, like we were)

`@0glabs/0g-serving-broker` was renamed to `@0gfoundation/0g-compute-ts-sdk`; the old package is
now just a re-export shim (npm says so explicitly). The org itself is also mid-migration —
`0glabs` still exists on GitHub, but some of its repos 404 and others 301-redirect to `0gfoundation`.
None of that is a problem by itself (renames happen), but it means anything that still says
`0glabs`/`0g-serving-broker`, including the flagship AI-assistant skill repo (issue #1 above), is
actively pointing new integrators at the wrong thing.

---

## ✅ What worked really well

- **The Compute Router is a genuinely drop-in OpenAI-compatible endpoint.** Swapping our existing
  Groq-shaped backend for the Router (`packages/provider/src/backends/zerog.ts`) was a same-shape
  `fetch` call — same request body, same response shape, no SDK, no wallet plumbing for the read
  path. For a marketplace that already routes across multiple backends, this was the cheapest
  integration of the whole stack.
- **`GET /v1/models` is public and honest.** We could list the live catalog (23 models, including
  the in-house `0gm-1.0-35b-a3b`) without an API key at all — good for picking a model before
  committing to funding one.
- **The auth failure mode is exactly right.** An unauthenticated completion call returns a clear
  `missing_authorization` error, not a confusing generic failure. Small thing, but it's the kind of
  detail that saves a debugging session (and a contrast with friction we hit elsewhere in this
  build — see our [Hedera feedback](HEDERAFEEDBACK.md) for a case where a bad key produces a bare,
  unhelpful error).
- **The TEE-attestation story, once found, is real and well-designed** — a per-provider signing key
  generated inside the enclave, bound to attestation reports, verifiable against request/response
  content. Issue #2 above is purely about discoverability, not about the mechanism itself.

---

## 🟡 Additional friction & suggestions (not yet filed as issues)

### Funding a Router key wasn't finished in time for a live demo (partly on us)
Getting `ZEROG_API_KEY` needs a wallet connection (MetaMask/WalletConnect, or social sign-in via
Privy) plus a testnet token deposit at `pc.0g.ai`. That's a reasonable, documented, self-service
flow — we don't want to overstate this as a product gap. In practice, in a fast-moving hackathon
window, we didn't complete it, so our live provider runs the documented canned fallback rather than
real 0G inference (`docs/PROOF.md` says so plainly). The one concrete suggestion: an
operator-seeds-everything path for verified hackathon/testnet accounts (the pattern Hedera's
`portal.hedera.com` operator flow uses) would remove the "did I actually fund this wallet in time"
uncertainty under time pressure.

### The Router's OpenAI-compatible response never surfaces `ZG-Res-Key` in one obvious place
Once we knew to look for it (via issue #2), reading the header was trivial. Before that, nothing in
the plain HTTP integration path signals that a verification-relevant header exists at all — it's
easy to consume the response body and never notice a header is even there. A one-line callout in
the Router quickstart itself ("responses carry `ZG-Res-Key` for later verification, see Inference
docs") would be enough, independent of the cross-link fix in issue #2.

---

## ⚪ Not 0G's fault (for credibility)

- We hadn't read the Inference doc page before assuming TEE verification wasn't exposed at all —
  it is, we were just looking at the wrong page (now filed as issue #2 instead of a wrong complaint).
- Our own `packages/provider/src/backends/zerog.ts` didn't originally preserve the upstream-reported
  model id or mark canned-fallback output as such — both fixed in our own code, not a 0G issue.
- No funded operator/testnet wallet on our dev machines during this session — environment, not 0G.

---

## TL;DR for 0G DevRel

The Compute Router itself was the smooth part of this integration — genuinely drop-in, honest error
messages, a real TEE-attestation story underneath. The highest-leverage improvements are **keeping
official tooling in sync with your own npm deprecations**, not the network:

1. **Fix the AI-assistant skill repo first** (issue #1) — it's the one actively telling every
   Claude Code / Cursor / Copilot session to install a package npm itself says is deprecated, across
   27 files including the CI check meant to prevent exactly this.
2. **Cross-link Router → Inference for verification** (issue #2) — the capability exists and is
   well-documented, it's just findable from the wrong page.

*— The AgentRouter team, ETHGlobal Lisbon 2026*
