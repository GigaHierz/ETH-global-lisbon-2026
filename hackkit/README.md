# Hackathon Starter — Hedera

Prepared by **Lena Hierzi**, DevRel Lead, Celo Core Co — 24 July 2026

A Claude Code environment for a hackathon team where most people do not write code.
Contracts in Solidity/Foundry, backend and frontend in TypeScript, deployed on Hedera.

The setup enforces three things automatically: work in small feature-sized pieces, review
everything before it reaches the repository, and start a fresh session between features.

---

## Setup — once per laptop

**Windows users: everything below runs inside WSL, not PowerShell.**
If you do not have WSL: open PowerShell as administrator, run `wsl --install`, restart,
then open the "Ubuntu" app and do everything there.

```bash
git clone <REPO_URL>
cd <REPO_NAME>
bash scripts/install.sh
```

The installer checks your tools, installs what is missing, wires up the git hooks, and
creates your `.env`.

Then get a Hedera testnet account at [portal.hedera.com](https://portal.hedera.com) — it
must be **ECDSA**, not ED25519 — and paste the account ID and private key into `.env`.

Finally, start Claude Code and install the skills plugin:

```bash
claude
```
```
/plugin install superpowers@claude-plugins-official
```

Restart the session. Setup is done.

---

## The daily loop

This is the whole job. Four steps, repeated.

### 1. Start a session

```bash
claude
```

Describe **one** feature in plain language. One. Not three.

> "Add a page that shows a user's token balance from the contract."

### 2. Let Claude build it

Answer its questions. Test that the thing works. Ask for changes if it does not.

### 3. Ship it

```
/ship-feature
```

Claude reviews the code for dead code and leftovers, fixes what it finds, writes a proper
commit message, pushes, and opens a pull request. If the review fails, it fixes and retries.

### 4. Start over, clean

```
/new-session
```

Then **close the terminal and open a new one.** Run `claude` again for the next feature.

This step matters more than it looks. A session that has already built something carries
all the false starts and abandoned attempts from that work. The next feature comes out
worse if you build it in the same session. A fresh session reads the handoff note and
starts clean.

---

## Commands

| Command | When |
| :-- | :-- |
| `/ship-feature` | A feature works and you want it in the repo |
| `/quality-gate` | You just want the review without pushing |
| `/new-session` | Finishing up, or Claude is getting confused |
| `/hedera-setup` | Something is broken and you do not know why |

---

## What is blocked automatically

You cannot push if the code contains:

- Dead code — functions nothing calls, unused imports and variables
- Commented-out code
- `console.log` and other debug leftovers
- `TODO`, `FIXME`, placeholder text, `lorem ipsum`
- Scratch files — `test.ts`, `notes.txt`, `temp/`
- Anything resembling a private key or API key
- Unformatted code, or failing tests

You also cannot:

- Push straight to `main` — feature branches only
- Commit with a message like "updates" or "WIP"
- Have Claude read or print your `.env`

If you are certain a block is wrong:

```bash
OVERRIDE_GATE=1 git push
```

Every override is logged to `.git/hackkit/override.log`. Use it rarely and expect to
explain it.

---

## Commit messages

The format is enforced:

```
feat(contracts): add token association guard
fix(backend): retry mirror node reads on 404
chore(ci): pin foundry version
```

`type(scope): what changed` — lowercase, imperative, no period.
Types: `feat` `fix` `chore` `docs` `test` `refactor` `perf` `ci` `build`.
Scopes: `contracts` `backend` `frontend` `deploy` `ci` `docs`.

Claude writes these for you during `/ship-feature`.

---

## When something breaks

```
/hedera-setup
```

Common causes, in order of likelihood:

| Symptom | Cause |
| :-- | :-- |
| Deploy fails intermittently | Hashio relay is beta and rate-limited. Retry, or switch to the local node. |
| `INVALID_SIGNATURE` | Your account is ED25519. EVM tooling needs ECDSA. Make a new one. |
| Token transfer fails | The receiving account must be associated with the token first. |
| `forge: command not found` | Restart your shell after install, or run `foundryup`. |
| Everything is slow (Windows) | Your repo is on `/mnt/c/`. Move it into the WSL home directory. |
| Revert with no reason given | Reproduce it in a Foundry test: `forge test -vvvv` gives a full trace. |

Never paste your `.env` or private key into chat when asking for help.

---

## Layout

```
CLAUDE.md              Rules Claude reads at the start of every session
.claude/
  settings.json        Hook wiring
  hooks/               Enforcement — runs outside Claude's control
  skills/              /ship-feature /quality-gate /new-session /hedera-setup
.githooks/             Backstop for commits made outside Claude Code
scripts/
  install.sh           One-time laptop setup
  quality-gate.sh      The automated checks
  doctor.sh            Diagnostics
contracts/  backend/  frontend/
docs/
  HANDOFF.md           Written by /new-session, read by the next session
  BACKLOG.md           Things noticed but deliberately not fixed
```

---

## How the enforcement works

Three layers, deliberately overlapping.

**`CLAUDE.md`** loads into every session as instructions. Cheap, always present, but a
model can drift from instructions over a long session.

**Hooks** are shell commands the harness runs, not the model. Claude cannot skip them or
argue with them. `PreToolUse` blocks the push; `Stop` injects reminders after each turn;
`SessionStart` loads the handoff.

**Skills** are the invokable workflows. They do the reasoning-based review that a regex
script cannot — judging whether a function is genuinely dead, whether the diff is really
one feature, whether this looks like a finished project.

The git hooks in `.githooks/` repeat the same checks for anyone who commits from a plain
terminal instead of through Claude.
