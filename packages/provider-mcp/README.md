# AgentRouter Provider MCP Server

An **MCP (Model Context Protocol) server** that lets an agent provision a new **AgentRouter
inference provider end-to-end** on Hedera Testnet — every step normally done by hand, exposed as
callable tools. Built with the Anthropic **mcp-builder** methodology (research → implement →
agent-facing evals), Node/TypeScript on `@modelcontextprotocol/sdk`.

A "provider" is AgentRouter's supply side: an OpenAI-compatible server that sells inference paid in
native HBAR over x402, with an HCS-14 identity and staked collateral on Hedera Consensus Service.
See [`docs/provider.md`](../../docs/provider.md) and [`docs/DEPLOY.md`](../../docs/DEPLOY.md).

## Tools

| Tool | What it does | Idempotency | Annotations |
|---|---|---|---|
| `create_provider_account` | Create + fund a Hedera Testnet account from the operator; persist `HEDERA_<role>_ID/KEY/EVM` to `.env` | skips if the role's account already exists (no spend) | destructive, idempotent |
| `stake_collateral` | Transfer collateral (default 50 ℏ) from the provider account to `HEDERA_ESCROW_ID` | skips if already staked (via `.registry-cache.json`) | destructive, idempotent |
| `register_provider` | Publish the HCS-14 registration JSON to the registry topic so the exchange discovers you | skips / re-registers on endpoint change | destructive, idempotent |
| `deploy_provider` | **Bring-your-own-compute**: health-check your already-running endpoint (`/healthz`, `/info`, x402 `402`), record it as `PROVIDER_PUBLIC_URL`, and return the exact Railway/VPS config | idempotent, read-only against the endpoint | idempotent |
| `verify_provider_live` | Poll the exchange `/providers` table (Mirror-Node-backed) until the wallet is `live`, and probe `/info` | read-only, safe to repeat | read-only, idempotent |
| `provision_provider` | **Orchestrator** — runs all of the above from one config, resumable (each step self-skips) | idempotent | destructive, idempotent |

All tools return **structured results** and, on failure, a structured error `{ code, message, hint }`
(never a raw stack trace or key). Errors are recoverable: because every step is idempotent, you fix
the cause and re-run.

### The deploy model (important)
Providers **bring their own compute** — a VPS, a Railway service, a GPU box they already run. So
`deploy_provider` does **not** spin up infrastructure or need your Railway login. It confirms your
running endpoint is a healthy AgentRouter provider and records its public URL. For anyone who still
needs to stand a box up, it returns the exact `railwayConfig` (env vars + `pnpm provider:prod` start
command). The one rule it enforces: **`PROVIDER_PUBLIC_URL` must be your public domain** — register
`localhost` and the exchange shows you `down`.

## Prerequisites

- **Node 22+** and **pnpm** (repo uses a pnpm workspace).
- A **funded Hedera Testnet operator** and an **escrow account** in the `.env` the server points at:
  `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` and `HEDERA_ESCROW_ID` (run `pnpm setup-hedera` once).
- For `verify_provider_live` to report `live`, the **exchange must be reachable** (locally: `pnpm exchange` or `pnpm demo`) and the provider's endpoint publicly reachable.

The server reads/writes the monorepo root `.env` by default; point it elsewhere with
`AGENTROUTER_ENV_PATH` (external operators bring their own `.env`).

## Run it

```bash
pnpm --filter @agentrouter/provider-mcp build   # typecheck (tsc --noEmit)
pnpm --filter @agentrouter/provider-mcp start   # run over stdio
# or inspect interactively:
pnpm --filter @agentrouter/provider-mcp inspect  # MCP Inspector
```

## Wire it into an MCP client

The repo ships this as a project-scoped [`.mcp.json`](../../.mcp.json) at its root, so in Claude
Code there is nothing to write — approve it once (`/mcp`) and the tools appear:

```json
{
  "mcpServers": {
    "agentrouter-provider": {
      "command": "pnpm",
      "args": ["-s", "--filter", "@agentrouter/provider-mcp", "start"]
    }
  }
}
```

The same `command`/`args` work in any stdio MCP client. No absolute paths are needed: `pnpm
--filter` finds the workspace root from any subdirectory, and `ENV_PATH` derives from the
server's own module location, so it resolves correctly in every clone and worktree. Set
`AGENTROUTER_ENV_PATH` only to target an `.env` outside the repo — and see the caveat under
Idempotency below. On a fresh clone the server won't connect until `pnpm install` has run.

Then the agent can call, e.g.:

```jsonc
// one-call onboarding
provision_provider({
  "name": "Acme Inference",
  "model": "llama-3.3-70b-versatile",
  "price": 0.08,
  "publicUrl": "https://acme-inference.up.railway.app",
  "exchangeUrl": "https://your-exchange.example.com"
})
```

## Evaluations

The agent-facing eval suite ships as part of the server (mcp-builder Phase 4):
[`evals/evaluation.xml`](evals/evaluation.xml) — 10 `<qa_pair>` cases with single, verifiable
answers. Because this server mutates state, the cases target its deterministic, agent-observable
surfaces (read-only discovery, the deploy config/error contract, idempotency, schema defaults); see
the header of that file for the adaptation rationale and the assumptions for the discovery cases.

Run them with the mcp-builder harness (`scripts/evaluation.py` from `anthropics/skills`):

```bash
python scripts/evaluation.py -t stdio -c node \
  -a "--import" -a "tsx" -a "$(pwd)/packages/provider-mcp/src/index.ts" \
  packages/provider-mcp/evals/evaluation.xml
```

## Environment variables

| Var | Used for |
|---|---|
| `HEDERA_OPERATOR_ID` / `HEDERA_OPERATOR_KEY` | funds new provider accounts |
| `HEDERA_ESCROW_ID` | destination for staked collateral |
| `HEDERA_<role>_ID` / `_KEY` / `_EVM` | the provider account (written by `create_provider_account`; role default `PROVIDER`) |
| `PROVIDER_PUBLIC_URL` | endpoint registered on HCS. **Written to `.env`** by `deploy_provider` and `register_provider` — see "Why it writes `.env`" below |
| `STAKE_HBAR` | stake amount (default 50) |
| `HCS_REGISTRY_TOPIC` | registry topic id (auto-resolved from `deployments.json` if unset) |
| `AGENTROUTER_ENV_PATH` | which `.env` file to read/write (default: monorepo root) |

## Design notes

- **Reuse, not rewrite.** The HCS-14 registration payload matches `packages/provider/src/registry.ts`
  `ensureRegistered()` exactly; account creation and staking replicate `scripts/setup-hedera-accounts.ts`
  and `stakeToEscrow()`. An MCP-provisioned provider is indistinguishable from a hand-provisioned one.
- **stdio hygiene.** Logs go to **stderr** only — stdout carries the MCP protocol.
- **Idempotency everywhere.** State is checked before every mutation (`.env` presence, the
  `.registry-cache.json` cache, Mirror Node), so re-running `provision_provider` resumes/repairs.

### Why it writes `PROVIDER_PUBLIC_URL` to `.env`

The invariant the system depends on is *the endpoint published to HCS equals the endpoint the
provider service re-derives on its next boot* — and that spans two processes. `pnpm provider`
reads `.env` at process start in whatever shell it was launched from; if `PROVIDER_PUBLIC_URL`
isn't there it falls back to `http://localhost:<port>`, sees a different endpoint than the one
cached, and republishes localhost over the good registration. The exchange reads the registry
topic last-write-wins, so the provider then shows `down`.

So both `deploy_provider` and `register_provider` **upsert** the value into `.env` (replacing any
existing line, never appending a duplicate: `readEnvVar` takes the first match while
`node --env-file` takes the last, and a duplicate would make the two disagree). The provider
service also refuses to downgrade a registered public endpoint to localhost, and warns instead.

### Idempotency caveats

- The stake check is **local**, not on-chain: it reads `.registry-cache.json`, which is
  gitignored. Delete that file and `stake_collateral` will move another 50 ℏ.
- That cache is resolved **relative to the `.env` directory** here, but relative to the **current
  working directory** by the provider service. They agree when you run `pnpm` from the repo root
  and leave `AGENTROUTER_ENV_PATH` unset. Diverge from either and the service won't see the
  cached stake — and will stake again.
