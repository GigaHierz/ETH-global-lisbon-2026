# Connecting the AgentRouter provider MCP server

Read this only when [SKILL.md](../SKILL.md) step 0 found no `provision_provider` tool **and** the
user wants the tools. The `pnpm` path in the skill is complete without them — this is a
convenience, not a prerequisite.

SKILL.md's key rule applies here too: these files point at `.env` files holding provider and
operator private keys. Never open one whole — check for presence with `grep -q` and nothing more.

## What the server is

`packages/provider-mcp` (`@agentrouter/provider-mcp`) exposes the onboarding steps as six MCP
tools over stdio. All return structured `{ code, message, hint }` errors, and all are idempotent
**as long as they and the provider service share one `.registry-cache.json`** — repo root,
`AGENTROUTER_ENV_PATH` unset, same machine. That caveat is the difference between a safe re-run
and a second 50 ℏ stake; see the bottom of this file.

| Tool | Does |
|---|---|
| `create_provider_account` | Creates + funds a Hedera Testnet account, writes `HEDERA_<role>_ID/KEY/EVM` to `.env` |
| `stake_collateral` | Moves the 50 ℏ bond to the escrow account, if the service hasn't already |
| `register_provider` | Publishes the HCS-14 registration, if the service hasn't already |
| `deploy_provider` | Health-checks an already-running endpoint, records its public URL, and returns a Railway/VPS config for the chosen `backend` (`0g` default \| `groq` \| `canned`) — it sets `PROVIDER_BACKEND` and wires the matching key (`ZEROG_API_KEY` / `GROQ_API_KEY`) |
| `verify_provider_live` | Polls the exchange routing table until the wallet shows `live` |
| `provision_provider` | Orchestrates all of the above, resumable |

In the normal flow the service has already staked and registered itself by the time you call
these — `pnpm provider` does both at boot, before it will serve anything. So `stake_collateral`
and `register_provider` usually report `alreadyStaked` / `alreadyRegistered` and change nothing.
They only do the work themselves in the remote-deploy case (SKILL.md step 5).

Full reference: [`packages/provider-mcp/README.md`](../../../../packages/provider-mcp/README.md).

## Connecting it

The repo ships a project-scoped `.mcp.json` at its root, so there is nothing to write:

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

1. **`pnpm install` in the repo root.** On a fresh clone the server fails to connect until
   `tsx` and the MCP SDK exist in `node_modules`. This is the most common cause.
2. **Approve it.** Claude Code asks once per user before it will run a project `.mcp.json`
   server — the repo cannot self-approve. Run `/mcp` to see the status and approve.
3. **Restart the session** if the tools still don't appear, then re-run step 0's check.

No absolute paths are needed: `pnpm --filter` finds the workspace root from any subdirectory,
and the server derives the `.env` path from its own module location, so it is correct in every
clone and worktree.

## Pointing it at a different `.env`

An operator running a provider outside this repo can override the target `.env`:

```json
"env": { "AGENTROUTER_ENV_PATH": "/path/to/their/.env" }
```

If you do this, note that the provider service resolves `.registry-cache.json` against its
**working directory** while the server resolves it against the **`.env` directory**. When those
differ the service won't see the cached stake and will stake another 50 ℏ. Keep them together,
or leave `AGENTROUTER_ENV_PATH` unset.

## Other MCP clients

Any stdio MCP client works — the same `command`/`args` in that client's own config. To inspect
the tools by hand:

```bash
pnpm --filter @agentrouter/provider-mcp inspect   # MCP Inspector
```
