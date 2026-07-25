---
name: new-session
description: Use when finishing a work session, when the user says they are done for now, when context is getting long or has been compacted, or right after shipping a feature. Writes a handoff note so the next session starts clean instead of re-deriving everything.
---

# Close out and hand off

A session that has shipped a feature is spent. Its context is full of dead ends, abandoned approaches, and details that no longer matter. Carrying it into the next feature makes that feature worse. This skill closes the loop.

## Step 1 — Check nothing is stranded

```
git status
git log --oneline -5
git rev-list --count @{u}..HEAD 2>/dev/null
```

Report clearly:
- Uncommitted changes? Ask whether to ship them (`/ship-feature`), stash them, or discard them. Do not decide for the user.
- Unpushed commits? Push them before writing the handoff.
- Anything half-built that would confuse the next session? Say so plainly.

## Step 2 — Write the handoff

Overwrite `docs/HANDOFF.md`. Keep it under 30 lines — this gets injected into the next session's context, so length is a real cost.

```markdown
# Handoff — <YYYY-MM-DD HH:MM>

## Shipped this session
- <feature> → <branch> → <PR link or "not yet merged">

## Repo state
- Branch: <branch>
- Uncommitted: <none | description>
- Unpushed: <none | N commits>

## Next up
- <the single next thing to build>

## Watch out for
- <gotchas discovered this session: relay flakiness, an API that behaves
  unexpectedly, a test that is slow, a decision made and why>

## Do not repeat
- <approaches tried that did not work, so the next session does not retry them>
```

The "do not repeat" section is the part that matters most. Without it, the next session rediscovers the same dead ends.

## Step 3 — Append to the backlog

Anything noticed but deliberately not fixed goes to `docs/BACKLOG.md` as a one-liner. Do not fix it now.

## Step 4 — Tell the user what to do

Say exactly this, adapted:

> Handoff written. Close this terminal, open a new one, run `claude`, and say what you want to build next. The new session will pick up the handoff automatically.

Do not offer to keep working. Do not start the next feature. The point of this skill is to end the session.
