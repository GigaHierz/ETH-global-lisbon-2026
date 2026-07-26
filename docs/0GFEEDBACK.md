# 0G Developer Feedback — AgentRouter (ETHGlobal Lisbon 2026)

Feedback from adding a **0G integration** to **AgentRouter** — an on-chain inference marketplace
where AI agents pay per LLM request. In one session we took 0G from "a canned-fallback provider
backend" to a live, verified integration across **three 0G products**: **0G Compute** (TEE-attested
inference via the Router + `@0gfoundation/0g-compute-ts-sdk` broker), **0G Chain** (Galileo testnet —
a `VerdictRegistry` for on-chain verification and an ERC-7857-style `AgentNFT` Agentic ID), and
**0G Storage** (AES-256-encrypted agent memory). Everything below was reproduced live on Galileo
(chain 16602) — real inference, deployed contracts, on-chain verdicts, a minted Agentic ID.

This is honest narrative — what worked, what caused friction, and what wasn't 0G's fault — so the
useful signal is easy to find. Per the ask, these are **suggestions, not filed issues**.

---

## ✅ What worked really well

Genuine positives worth keeping and promoting.

- **OpenAI-compatible Router is a true drop-in.** Point any OpenAI SDK at `router-api.0g.ai/v1`
  with a `Bearer` key and it just works — we got a real `0gm-1.0-35b-a3b` completion on the first
  correct call. Changing only `base_url` + `api_key` is exactly the right ergonomics.
- **TEE via one header.** `X-0G-Provider-Trust-Mode: verified` to get attested inference is an
  elegant abstraction — no per-request signing needed on the Router path.
- **Contract addresses auto-detected from chain ID** in the compute SDK
  (`createZGComputeNetworkBroker(wallet)`) — no hardcoding ledger/inference addresses. Nice.
- **Built-in AES-256 encryption in 0G Storage** (`@0gfoundation/0g-storage-ts-sdk`,
  `encryption: { type: "aes256", key }`) — encrypted memory with one option, no hand-rolled crypto.
- **EVM compatibility is real.** `forge script` deployed our `VerdictRegistry` + `AgentNFT` to
  Galileo with stock Foundry (solc 0.8.24) on the first try — standard tooling, no surprises.
- **A live ERC-8004 IdentityRegistry at a vanity `0x8004…` address** on testnet is a thoughtful
  touch for agent discoverability.
- **Gas is cheap and fast** — deploys, mints, and verdict writes on Galileo were sub-second and
  a fraction of a testnet 0G each.

---

## 🟡 Friction & suggestions

Concrete, reproducible papercuts — ordered roughly by how much time each cost us.

### 1. Two package scopes mid-migration (`@0glabs/*` → `@0gfoundation/*`)
The single biggest time sink. The current packages are:

| Product | Current (recommended) | Deprecated / older |
|---|---|---|
| Compute | `@0gfoundation/0g-compute-ts-sdk@0.9.0` | `@0glabs/0g-serving-broker` (README says "renamed as of v0.8.0") |
| Storage | `@0gfoundation/0g-storage-ts-sdk@1.2.10` (**has** encryption) | `@0glabs/0g-ts-sdk@0.3.3` (**no** encryption) |

`docs.0g.ai` references the `@0gfoundation/*` packages, but the **official skills repos still install
`@0glabs/*`** (see skills feedback below). We had to `npm pack` both scopes and read the `.d.ts`
files to establish ground truth — including the non-obvious fact that only the newer storage package
has built-in encryption. **Ask:** converge on one scope, add npm deprecation notices to the old
names, and update every doc + skill in lockstep.

### 2. Mainnet vs testnet split is a trap (keys + endpoints)
Two of everything, and mixing them fails opaquely:
- Router: `router-api.0g.ai/v1` (mainnet) vs `router-api-testnet.integratenetwork.work/v1`
  (testnet — an unbranded third-party domain that doesn't look official).
- Portal: `pc.0g.ai` (mainnet) vs `pc.testnet.0g.ai` (testnet).

A mainnet key against the testnet router returns `{"code":"invalid_api_key"}`; our first attempt hit
`{"code":"invalid_auth"}` purely from an environment mismatch, which sent us debugging the key when
the key was fine. **Ask:** one obvious network switch in the portal, a branded testnet router
domain, and an error body that says *"this looks like a mainnet key — you're calling the testnet
router"* instead of a bare `invalid_auth`.

### 3. Faucet allowance + claim-status clarity
`faucet.0g.ai` gives **0.1 0G/wallet/day**. That's tight for a build that deploys two contracts,
mints, and does storage uploads (each costs gas). We also hit a confusing state: the faucet showed
*"Next claim available in 8h 50m"* while the wallet balance was **0** — no signal whether the prior
claim was pending, failed, or sent to a mistyped address. **Ask:** surface claim status/tx on the
faucet, and raise the hackathon allowance (or offer a promo-code bump).

### 4. TEE attestation on the Router path is under-documented
`X-0G-Provider-Trust-Mode: verified` is easy to *send*, but reading the attestation back is
folklore: the reference comes in a **`ZG-Res-Key` response header**, and because the OpenAI SDK
hides raw headers you must drop to `fetch` to read it. We inferred this from the broker code.
**Ask:** a "how to read + verify a Router response's attestation" page, and an explicit note that
`processResponse`/`ZG-Res-Key` verification needs raw headers (OpenAI SDK won't expose them).

### 5. 0G Storage SDK sharp edges
All real, all cost us a cycle:
- **No `ZgFile.fromBuffer`.** To upload an in-memory `Buffer`/`Uint8Array` you must use
  `new MemData(bytes)` — discoverable only by reading types.
- **`upload()` return shape.** It returns `{ txHash, rootHash, txSeq }` (single) — but the README
  still shows the outdated `[tx, err]` shape. The TS type is a union with the multi-file
  `{ txHashes, rootHashes, txSeqs }`, so you must narrow before using `rootHash`.
- **Merkle root gotcha.** If you call `file.merkleTree()` on plaintext but upload *with* encryption,
  the stored root differs (the SDK wraps encryption first) — you must take the root from the
  `upload()` return, not compute it yourself. Worth a bold callout.
- **Upload UX.** Uploads logged repeated `Waiting for storage node to sync (height=…)` for ~10s
  with no progress/ETA — looks stuck. A progress callback or a quieter default would help.

### 6. 0G Chain / Agentic ID (ERC-7857 / ERC-8004)
The AI-product-track "Agentic ID" story was the least paved path:
- **No canonical deployed AgentNFT (ERC-7857)** on testnet — the docs show deploy-your-own plus a
  simplified `AgenticID` example, so we shipped our own minimal ERC-7857-style contract. A published,
  source-verified AgentNFT address would let teams mint against it in minutes.
- **The live ERC-8004 registry `0x8004A818BFB912233c491871b3d84c89A494BD9e` has unverified source**
  on chainscan, so we couldn't confirm the exact `register(...)` selector without a static call.
  Verifying the source would remove the guesswork.
- **Full ERC-7857 transfer needs a TEE/ZKP re-encryption oracle** — a lot of machinery for a
  hackathon "tradeable memory" demo; a documented "demo-grade" transfer path would help.
- **`mintFee()`** has no confirmed public getter — you `estimateGas`/guess. Expose it.

### 7. Compute broker ergonomics
Minor but real: `acknowledgeProviderSigner` (user) vs `acknowledgeProviderTEESigner` (owner-only)
are easy to confuse; `getRequestHeaders` now returns only `Authorization` but keeps deprecated
fields in the type; and first-time `addLedger(amount)` vs subsequent `depositFund(amount)` is manual
try/catch. A single `ensureLedger(amount)` helper would smooth onboarding.

---

## 🎓 Feedback on the Skills (`0g-compute-skills`, `0g-agent-skills`)

The skills are genuinely useful for scaffolding Storage/Compute/Chain code — a good idea, well
structured. Suggestions:

- **Update the pinned package names.** Both repos install the **deprecated `@0glabs/*`** packages
  (`0g-serving-broker`, `0g-ts-sdk@^0.3.3`). The `0g-ts-sdk@0.3.3` pin is actively harmful for the
  memory use case because it **lacks encryption** — a team following the skill can't encrypt memory
  without silently switching packages.
- **Resolve the two-repos confusion.** `0g-compute-skills` states it's "superseded by
  `0g-agent-skills`" yet still exists and is installable — a clear banner or a redirect/consolidation
  would stop teams starting on the wrong one.
- **Add skills for what the prize tracks actually ask for.** The current skills cover Storage /
  Compute / Chain *primitives*, but **nothing covers the two headline hackathon patterns**:
  1. **Minting an Agentic ID** (ERC-7857 `AgentNFT` or ERC-8004 registry) whose intelligent-data
     points at encrypted 0G Storage memory — i.e. "**tradeable memory via Agentic ID**".
  2. A **model-routing / provenance layer with verification tracked on-chain** — the Infra track's
     own example. We built both from scratch; a skill each would have saved hours and is exactly the
     composition 0G is promoting.
- **TEE-attested inference recipe.** A skill showing `X-0G-Provider-Trust-Mode: verified` + reading
  `ZG-Res-Key` (with the OpenAI-SDK header caveat) would codify the folklore from friction #4.

---

## 📖 Feedback on the Docs (`docs.0g.ai`, `/ai-context`)

- **A single, version-pinned quickstart table would fix most of the above.** One authoritative grid:
  *product → exact package name + version → network → endpoint → contract addresses*. Today those
  facts are spread across the docs, the skills, and the package READMEs, and they disagree (scope,
  chain id, encryption support).
- **`/ai-context` is a great idea** (one page for LLM coding assistants) — but it mixes mainnet and
  testnet and both package scopes without a clear per-network split, so an assistant reading it can
  still emit a mainnet endpoint + a deprecated package. Split by network and pin versions.
- **Stale chain id.** Some sources still show `16601`; the live testnet RPC returns **16602**
  (`eth_chainId → 0x40da`). Sweep the docs.
- **Cross-reference mismatch.** The INFT / ERC-7857 integration guide references
  `@0gfoundation/0g-storage-ts-sdk` while the storage skill installs `@0glabs/0g-ts-sdk` — pick one.

---

## ⚪ Not 0G's fault (for credibility)

So the signal above stays honest — most of these were our environment / our code:

- Default **Node 20** silently broke `pnpm`/`tsx` on the dev machine; Node 22 fixed it.
- Firing several `viem` contract writes back-to-back, one Agentic-ID mint failed on a **nonce race** —
  our tooling, not 0G (a note in docs that rapid sequential txs need nonce management would still be kind).
- Our initial `invalid_auth` confusion was partly self-inflicted: we linked `pc.0g.ai` (mainnet)
  while doing testnet work (see friction #2 for the part that *is* a DX ask).

---

## TL;DR for 0G DevRel

0G's core primitives are strong — OpenAI-compatible + TEE-header inference, auto-detected contracts,
built-in storage encryption, and clean EVM deploys all worked. The highest-leverage fixes are
**developer experience, packaging, and docs**, not the platform:

1. **Unify on `@0gfoundation/*`**, deprecate `@0glabs/*` on npm, and update the **skills + docs in
   lockstep** — the `0g-ts-sdk@0.3.3` (no-encryption) pin in the skills is the sharpest edge.
2. **Make the mainnet/testnet split obvious** — portal switch, a branded testnet router domain, and
   key errors that name the wrong-network cause instead of a bare `invalid_auth`.
3. **Ship canonical, runnable examples + skills for the two headline patterns** — "Agentic ID +
   encrypted 0G Storage memory" (tradeable memory) and "model-routing/provenance with on-chain
   verification." Both are prize-track suggestions with no skill today.
4. **Verify contract source on the Galileo explorer** (the ERC-8004 registry, plus a canonical
   AgentNFT) so builders don't reverse-engineer selectors.
5. **Fix the 0G Storage README** (return shape, `MemData` for buffers, the merkle-root-vs-return
   gotcha, encryption-only-in-newer-package) and add upload progress.
6. **Raise the faucet allowance and show claim status** — 0.1/day is tight for a contract-heavy build.

*— The AgentRouter team, ETHGlobal Lisbon 2026*
