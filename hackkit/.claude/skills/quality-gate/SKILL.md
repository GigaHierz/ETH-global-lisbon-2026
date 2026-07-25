---
name: quality-gate
description: Use before any push, and whenever the user asks for a code review, asks whether the code is clean, or mentions dead code. Runs automated checks then does a manual review for dead code, scope creep, and anything that does not belong in the final project.
---

# Quality gate

Two passes. The script catches what is mechanical. You catch what is not. Both must be clean.

## Pass 1 — Automated

```
bash scripts/quality-gate.sh
```

This checks: secrets, stray files, debug statements, commented-out code, placeholders, unused exports and imports, `forge build`, `forge fmt`, `forge test`, `tsc --noEmit`, prettier, and diff size.

Report failures verbatim. Fix each one. Re-run until it passes.

Warnings are not blockers, but read them — "no test file for this contract" is a warning that usually should have been a failure.

## Pass 2 — Manual review

The script cannot judge intent. You can. Read the actual diff:

```
git diff HEAD
git diff --cached
```

Check every item below and report on each explicitly. Do not say "looks good" without having gone through the list.

### Dead code the script misses

- Functions defined and never called anywhere in the repo. Grep for each new function name; one hit means it is dead.
- Contract functions with no caller and no test. `public`/`external` may be intentional API — say so and confirm with the user rather than assuming.
- Branches that cannot be reached given the surrounding conditions.
- Parameters accepted and never used.
- State variables written but never read, or read but never written.
- Imports of modules whose symbols do not appear in the file.
- Event definitions never emitted. Error definitions never reverted with.
- Entire files added that nothing imports.

### Scope creep

- Does every hunk in this diff belong to the stated feature? Anything unrelated should be a separate commit.
- Formatting-only changes to files this feature did not otherwise touch — revert them, they bury the real diff.
- Dependencies added: is each one actually used? Name the file that uses it.
- Config changes: was each one necessary for this feature?

### Does it represent the final project

- Would you show this file to a judge? Hardcoded test addresses, `if (true)` shortcuts, and stubbed returns say no.
- Placeholder copy in the UI: "Lorem ipsum", "Click me", "Title here".
- Hardcoded values that should be config: RPC URLs, contract addresses, chain IDs, magic numbers.
- Error handling that swallows everything: `catch {}`, `try/catch` with an empty body, `.catch(() => {})`.
- `any` types added to make the compiler stop complaining.

### Hedera-specific

- Are contract addresses and account IDs read from config, not hardcoded?
- Does anything assume 18-decimal HBAR where the SDK returns 8, or vice versa? Over JSON-RPC, `msg.value` and `gasPrice` come back with 18 decimals — confirm the conversion is deliberate.
- HTS token operations: is association handled before transfer?
- Are gas limits set explicitly where the relay needs them?
- Is any private key or account ID present in a committed file?

### Tests

- Every new contract function has at least one Foundry test.
- Tests assert on outcomes, not just that a call did not revert.
- No test is skipped, commented out, or renamed to avoid running.

## Output

Report as:

```
AUTOMATED: pass | N failures
MANUAL:
  Dead code:      <findings or "none">
  Scope creep:    <findings or "none">
  Final quality:  <findings or "none">
  Hedera:         <findings or "none">
  Tests:          <findings or "none">

VERDICT: clean | blocked
```

If blocked, list what must change. Fix the items, then run the whole gate again from Pass 1.

Never mark a gate clean because the script passed. The script is the floor, not the bar.
