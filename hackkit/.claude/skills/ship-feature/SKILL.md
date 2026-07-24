---
name: ship-feature
description: Use when a feature is finished and ready to go to the repository. Runs the quality gate, writes a proper commit message, pushes, and opens a pull request. Trigger on "ship it", "I'm done", "push this", "commit this", or when the user says a feature is complete.
---

# Ship a feature

Take one completed feature from working tree to open pull request. Do not skip steps and do not reorder them.

## Step 1 — Confirm scope

Run `git status` and `git diff --stat`.

State back to the user, in one or two sentences, what feature these changes represent.

If the diff contains more than one logical feature, stop and say so. Offer to split it into separate commits. Do not ship two features in one commit because it is convenient.

If the diff is over ~800 lines, flag it — that is almost always more than one feature.

## Step 2 — Branch check

Run `git rev-parse --abbrev-ref HEAD`.

If on `main` or `master`, create a branch now:

```
git checkout -b feat/<short-kebab-name>
```

Name it after the feature, not after the person or the day.

## Step 3 — Quality gate

Run the `quality-gate` skill. Do not run `scripts/quality-gate.sh` directly and read only the exit code — use the skill, because it does the reasoning-based review the script cannot.

If the gate fails: fix every failure, then run it again. Repeat until clean.

Never suggest `OVERRIDE_GATE=1` to the user. The override exists for a human who has consciously decided to bypass a check, not for Claude to route around a failure.

## Step 4 — Commit

Stage only files that belong to this feature:

```
git add <specific paths>
```

Do not use `git add -A` or `git add .` — that is how stray files get committed.

Write a Conventional Commit:

```
<type>(<scope>): <subject>

<body: why this change exists, what tradeoff was made, what it does not do>
```

Rules:
- `type`: feat, fix, chore, docs, test, refactor, perf, ci, build
- `scope`: contracts, backend, frontend, deploy, ci, docs
- subject: imperative, lowercase, no period, ≤72 chars
- body: only if it adds something the diff does not already say. Skip it for trivial changes.
- Never write "WIP", "updates", "fixes", or "final"

Show the message to the user before committing.

## Step 5 — Push

```
git push -u origin <branch>
```

The pre-push hook checks that the gate passed for this exact commit. If it blocks, the gate stamp is stale — re-run step 3.

## Step 6 — Pull request

If `gh` is available:

```
gh pr create --title "<commit subject>" --body "<summary>"
```

PR body:
- **What** — one line
- **Why** — one line
- **How to test** — the exact commands a reviewer runs
- **Notes** — anything intentionally left out

If `gh` is not installed, print the compare URL and tell the user to open it.

## Step 7 — Close out

Tell the user, in this order:

1. The branch name and PR link
2. That this session should now end
3. To run `/new-session`, then close the terminal and open a fresh one for the next feature

Do not start the next feature in this session. If the user asks you to, remind them once that context from a shipped feature degrades the next one, then respect their decision if they insist.
