# Project Rules

Hackathon project on **Hedera** (Solidity + Foundry contracts, TypeScript backend, TypeScript frontend).
Everyone on this team uses Claude Code with the `superpowers` plugin installed.

Read this file fully before doing anything. These rules are not suggestions.

---

## 1. Core loop — one feature at a time

Work in this cycle and never deviate:

```
pick ONE feature  →  branch  →  build  →  /quality-gate  →  commit  →  push  →  PR  →  /new-session
```

Rules:

- **One feature per branch, one branch per session.** Do not start feature B in the session where you built feature A.
- Do not batch multiple features into one commit.
- When a feature is done and pushed, the session is over. Start a fresh session for the next feature.
- If you find yourself fixing something unrelated to the current feature, stop. Note it in `docs/BACKLOG.md` and keep going on the current feature.

## 2. Branch naming

`feat/<short-kebab-name>` · `fix/<short-kebab-name>` · `chore/<short-kebab-name>`

Never commit directly to `main`. The pre-push hook blocks it.

## 3. Commit messages

Conventional Commits. The commit-msg hook enforces this.

```
<type>(<scope>): <subject>

<optional body — WHY, not what>
```

- `type`: `feat` `fix` `chore` `docs` `test` `refactor` `perf` `ci` `build` `style` `revert`
- `scope`: `contracts` `backend` `frontend` `deploy` `ci` `docs` (optional but preferred)
- `subject`: imperative mood, lowercase, no trailing period, ≤ 72 chars

Good:
```
feat(contracts): add HTS token association guard to Vault
fix(backend): handle mirror node 404 on fresh contract reads
```

Bad: `updated stuff`, `fixes`, `WIP`, `asdf`, `Final version 2`

## 4. Quality bar — what gets blocked

Nothing reaches the remote if it contains:

- **Dead code** — unused functions, unreachable branches, unused imports, unused variables
- **Commented-out code** — delete it, git remembers
- **Debug leftovers** — `console.log`, `console.debug`, `forge` `console.log`/`console2.log` in non-test Solidity
- **Placeholders shipped as done** — `TODO`, `FIXME`, `XXX`, `HACK`, `lorem ipsum`, `foo/bar` naming
- **Stray files** — `test.ts`, `notes.txt`, `Untitled.sol`, `temp/`, `.DS_Store`, editor scratch files
- **Secrets** — anything matching a private key, mnemonic, or API key pattern. Never commit `.env`.
- **Unformatted code** — `forge fmt` and `prettier` must be clean
- **Failing tests** — `forge test` must pass

## 5. Secrets

- `.env` is gitignored. Never read it, never print it, never commit it.
- Use `.env.example` to document required variables with dummy values.
- Hedera keys are ECDSA hex-encoded. If one ever appears in a diff, it is compromised — rotate it.

## 6. Hedera specifics

- Contracts target the Hedera EVM via the Hiero JSON-RPC relay.
- Local dev: Hiero Local Node (fast, unlimited HBAR). Shared testnet: Hashio (`https://testnet.hashio.io/api`).
- Hashio is beta and rate-limited. If deploys fail intermittently, that is the relay, not your code — retry before debugging.
- Gas and `msg.value` come back with 18 decimals over JSON-RPC even though HBAR has 8. Do not "fix" this.
- Unit tests run against Foundry's local EVM (`forge test`). Integration tests run against the local node or testnet.
- Verify deployed contracts on HashScan.

## 7. Writing code — non-negotiables

- Do not invent APIs. If unsure of a Hedera SDK or precompile signature, look it up before writing.
- Do not scaffold files "for later." Build only what the current feature needs.
- Do not add dependencies without saying why in the PR description.
- Every new contract function gets at least one Foundry test.
- Keep functions short enough to read in one screen.

## 8. Session hygiene

Long sessions rot. Context fills with dead ends and the quality drops.

Start a new session when any of these is true:
- the current feature is pushed
- you have been in this session more than ~90 minutes
- you have compacted context once already
- you switched to a different part of the stack (contracts → frontend)

Before ending a session, run `/new-session` to write a handoff note.

## 9. Available commands

| Command | What it does |
| :-- | :-- |
| `/quality-gate` | Full review: dead code, debug leftovers, stray files, tests, formatting |
| `/ship-feature` | Gate + commit + push + PR, end to end |
| `/new-session` | Write handoff notes and close out cleanly |
| `/hedera-setup` | Diagnose and fix local environment problems |

## 10. If you are not a developer

You do not need to understand the code. You need to follow the loop.

1. Say what you want to build, in plain language, one thing at a time.
2. Let Claude build it.
3. Type `/ship-feature`. Claude reviews, commits, pushes, and opens a PR.
4. Type `/new-session`, then close the terminal and open a fresh one.
5. Repeat.

If something breaks: type `/hedera-setup`. If that fails, post the error in the team chat. Do not paste your `.env`.
