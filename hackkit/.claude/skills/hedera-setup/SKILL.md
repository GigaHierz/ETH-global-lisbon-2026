---
name: hedera-setup
description: Use when the environment is broken — forge or node not found, deploys failing, RPC errors, contracts not compiling, tests not running, or a teammate cannot get the project running at all. Diagnoses and fixes local setup for the Hedera stack.
---

# Fix the environment

Diagnose before changing anything. Run the checks, then fix only what is broken.

## Step 1 — Diagnose

```
bash scripts/doctor.sh
```

Report exactly what failed. Do not start installing things that already work.

## Step 2 — Fix by symptom

### `forge: command not found`

```
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Then restart the shell. On Windows this must run inside WSL, not PowerShell.

### `node: command not found` or Node version below 20

Install Node 20 LTS via nvm. Do not use the system package manager version — it is usually too old.

### `forge build` fails on imports

Remappings are missing. `foundry.toml` needs:

```toml
remappings = [
  "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
  "forge-std/=lib/forge-std/src/"
]
```

Then `forge install` to pull the libs.

### Deploy fails with a network or timeout error

Hashio is a beta, rate-limited relay. This is usually not your code.

1. Retry once. Intermittent failures are normal.
2. Confirm `HEDERA_RPC_URL` is set and reachable.
3. If it keeps failing, switch to Hiero Local Node — it is faster and has unlimited HBAR:
   ```
   npx @hashgraph/hedera-local start
   ```
   Then point `HEDERA_RPC_URL` at the local relay.

### `insufficient funds` on testnet

Testnet accounts refill from the Hedera Portal. Get a fresh allocation there.

### Transaction reverts with no reason

Hedera's relay does not always surface revert reasons. Reproduce the failure in a Foundry test against the local EVM (`forge test -vvvv`) where you get a full trace.

### `INVALID_SIGNATURE` or key errors

The account must be **ECDSA**, not ED25519. ED25519 accounts do not work with EVM tooling. Create an ECDSA account in the Hedera Portal.

### HTS token transfer fails

The receiving account must be associated with the token before it can receive it. Association is not automatic.

### Windows-specific

Everything runs in WSL2. If commands are being run in PowerShell or CMD, that is the problem. The repository should live inside the WSL filesystem (`~/project`), not on `/mnt/c/` — the latter is dramatically slower and breaks file watching.

## Step 3 — Verify

```
forge build && forge test
npm run build
```

Both must pass before declaring the environment fixed.

## Step 4 — Record it

If the fix was not obvious, add a line to `docs/BACKLOG.md` under a "Setup gotchas" heading so the next person does not lose the same hour.

## Never

- Do not ask the user to paste their `.env` or private key. Ever. If you need to know whether a variable is set, have them run `[ -n "$VAR" ] && echo set || echo missing`.
- Do not commit a fix to `.env`. Update `.env.example` instead.
