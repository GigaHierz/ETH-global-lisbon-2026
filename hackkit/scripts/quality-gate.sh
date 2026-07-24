#!/usr/bin/env bash
# Quality gate. Run before every push.
#   scripts/quality-gate.sh            # check the working tree + staged changes
#   scripts/quality-gate.sh --staged   # check staged changes only (used by pre-commit)
#
# Exit 0 = clean, writes .git/hackkit/gate-pass with the HEAD sha.
# Exit 1 = problems found, prints them.
set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"
ROOT=$(pwd)
STAMP_DIR="$ROOT/.git/hackkit"
STAGED_ONLY=0
[ "${1:-}" = "--staged" ] && STAGED_ONLY=1

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; DIM=$'\033[2m'; RST=$'\033[0m'
FAILURES=0
WARNINGS=0

fail() { printf '%s  FAIL%s  %s\n' "$RED" "$RST" "$1"; FAILURES=$((FAILURES+1)); }
warn() { printf '%s  WARN%s  %s\n' "$YLW" "$RST" "$1"; WARNINGS=$((WARNINGS+1)); }
pass() { printf '%s  ok  %s  %s\n' "$GRN" "$RST" "$1"; }
head_() { printf '\n%s== %s ==%s\n' "$DIM" "$1" "$RST"; }

# ---------------------------------------------------------------- file list
if [ "$STAGED_ONLY" -eq 1 ]; then
  FILES=$(git diff --cached --name-only --diff-filter=ACMR)
else
  BASE=$(git merge-base HEAD origin/main 2>/dev/null || git rev-list --max-parents=0 HEAD 2>/dev/null | tail -1)
  FILES=$(
    { git diff --name-only --diff-filter=ACMR "$BASE" HEAD 2>/dev/null
      git diff --cached --name-only --diff-filter=ACMR
      git diff --name-only --diff-filter=ACMR
    } | sort -u
  )
fi
FILES=$(printf '%s\n' "$FILES" | grep -vE '^$' || true)

if [ -z "$FILES" ]; then
  printf '%sNothing to check — no changed files.%s\n' "$YLW" "$RST"
  exit 0
fi

sol_files()  { printf '%s\n' "$FILES" | grep -E '\.sol$'  | grep -vE '(^|/)(test|script|lib)/' || true; }
sol_all()    { printf '%s\n' "$FILES" | grep -E '\.sol$' || true; }
ts_files()   { printf '%s\n' "$FILES" | grep -E '\.(ts|tsx|js|jsx)$' | grep -vE '\.(test|spec)\.' || true; }
ts_all()     { printf '%s\n' "$FILES" | grep -E '\.(ts|tsx|js|jsx)$' || true; }
exists()     { [ -f "$1" ]; }
present()    { [ -n "$(printf '%s' "$1" | tr -d '[:space:]')" ]; }

printf '\n%s Quality gate %s  %s files changed\n' "$DIM" "$RST" "$(printf '%s\n' "$FILES" | wc -l | tr -d ' ')"

# ---------------------------------------------------------------- 1. secrets
head_ "Secrets"
SECRET_HITS=""
for f in $FILES; do
  [ -f "$f" ] || continue
  case "$f" in *.lock|*.png|*.jpg|*.svg|*.gif|*.pdf|*.ico) continue;; esac
  # ECDSA/ed25519 hex private keys, mnemonics, common API key shapes
  if grep -nEH '0x[a-fA-F0-9]{64}' "$f" 2>/dev/null | grep -vE '(test|mock|example|0x0{60,})' | head -3 | grep -q .; then
    SECRET_HITS="$SECRET_HITS\n  $f  (64-char hex — possible private key)"
  fi
  if grep -nEHi '(mnemonic|seed[ _]?phrase)[[:space:]]*[:=][[:space:]]*["'"'"']([a-z]+ ){11,}' "$f" 2>/dev/null | head -1 | grep -q .; then
    SECRET_HITS="$SECRET_HITS\n  $f  (mnemonic phrase)"
  fi
  if grep -nEH '(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36})' "$f" 2>/dev/null | head -1 | grep -q .; then
    SECRET_HITS="$SECRET_HITS\n  $f  (API key)"
  fi
done
if printf '%s\n' "$FILES" | grep -qE '(^|/)\.env($|\.)' ; then
  SECRET_HITS="$SECRET_HITS\n  .env is being committed"
fi
if [ -n "$SECRET_HITS" ]; then
  fail "possible secrets in the diff:$(printf '%b' "$SECRET_HITS")"
else
  pass "no secrets detected"
fi

# ---------------------------------------------------------------- 2. stray files
head_ "Stray files"
STRAY=$(printf '%s\n' "$FILES" | grep -iE '(^|/)(test|temp|tmp|untitled|scratch|notes|asdf|new file|copy of )[^/]*\.(ts|tsx|js|jsx|sol|txt|md|json)$|\.DS_Store$|(^|/)(temp|tmp|scratch)/|~$|\.orig$|\.rej$|\.bak$|\.swp$' || true)
if present "$STRAY"; then
  fail "scratch/temp files staged for commit:"
  printf '%s\n' "$STRAY" | sed 's/^/         /'
else
  pass "no stray files"
fi

# ---------------------------------------------------------------- 3. debug leftovers
head_ "Debug leftovers"
DEBUG=""
for f in $(ts_files); do
  [ -f "$f" ] || continue
  H=$(grep -nE '(^|[^a-zA-Z0-9_.])console\.(log|debug|dir|trace)\(|(^|[^a-zA-Z0-9_.])debugger[;[:space:]]' "$f" 2>/dev/null || true)
  present "$H" && DEBUG="$DEBUG\n  $f:\n$(printf '%s' "$H" | sed 's/^/           /')"
done
for f in $(sol_files); do
  [ -f "$f" ] || continue
  H=$(grep -nE 'console2?\.log|import[[:space:]]+.*forge-std/console' "$f" 2>/dev/null || true)
  present "$H" && DEBUG="$DEBUG\n  $f:\n$(printf '%s' "$H" | sed 's/^/           /')"
done
if [ -n "$DEBUG" ]; then
  fail "debug statements in non-test code:$(printf '%b' "$DEBUG")"
else
  pass "no debug statements"
fi

# ---------------------------------------------------------------- 4. commented-out code
head_ "Commented-out code"
COMMENTED=""
for f in $(ts_all) $(sol_all); do
  [ -f "$f" ] || continue
  # Comment lines that look like real statements, not prose
  H=$(grep -nE '^[[:space:]]*//[[:space:]]*([a-zA-Z_$][a-zA-Z0-9_$.]*[[:space:]]*[({=]|(const|let|var|function|return|if|for|while|import|export|require|address|uint|mapping|emit|revert)[[:space:]])' "$f" 2>/dev/null | grep -vE '//[[:space:]]*(TODO|NOTE|FIXME|eslint|@|prettier|SPDX|solhint)' | head -5 || true)
  present "$H" && COMMENTED="$COMMENTED\n  $f:\n$(printf '%s' "$H" | sed 's/^/           /')"
done
if [ -n "$COMMENTED" ]; then
  fail "commented-out code — delete it, git has the history:$(printf '%b' "$COMMENTED")"
else
  pass "no commented-out code"
fi

# ---------------------------------------------------------------- 5. placeholders
head_ "Placeholders"
PLACE=""
for f in $(ts_all) $(sol_all); do
  [ -f "$f" ] || continue
  H=$(grep -nEi '(TODO|FIXME|XXX|HACK)[:( ]|lorem ipsum|your-?(api-?)?key-?here|CHANGE_?ME|<REPLACE|foo[[:space:]]*=|\bbar\b[[:space:]]*=' "$f" 2>/dev/null | head -5 || true)
  present "$H" && PLACE="$PLACE\n  $f:\n$(printf '%s' "$H" | sed 's/^/           /')"
done
if [ -n "$PLACE" ]; then
  fail "placeholders left in code:$(printf '%b' "$PLACE")"
else
  pass "no placeholders"
fi

# ---------------------------------------------------------------- 6. dead code (TS)
head_ "Dead code"
DEAD_RUN=0
if exists "package.json"; then
  if npx --no-install knip --version >/dev/null 2>&1; then
    DEAD_RUN=1
    OUT=$(npx --no-install knip --no-progress --reporter compact 2>&1 || true)
    if printf '%s' "$OUT" | grep -qE 'Unused (files|dependencies|exports)'; then
      fail "knip found unused files/exports/dependencies:"
      printf '%s\n' "$OUT" | head -25 | sed 's/^/         /'
    else
      pass "knip clean"
    fi
  elif npx --no-install ts-prune --version >/dev/null 2>&1; then
    DEAD_RUN=1
    OUT=$(npx --no-install ts-prune 2>/dev/null | grep -v '(used in module)' || true)
    if present "$OUT"; then
      warn "ts-prune found unused exports:"
      printf '%s\n' "$OUT" | head -20 | sed 's/^/         /'
    else
      pass "ts-prune clean"
    fi
  fi
  # eslint catches unused vars/imports
  if npx --no-install eslint --version >/dev/null 2>&1; then
    DEAD_RUN=1
    TSF=$(ts_all | tr '\n' ' ')
    if present "$TSF"; then
      OUT=$(npx --no-install eslint $TSF --format unix 2>&1 || true)
      if printf '%s' "$OUT" | grep -qE 'Error'; then
        fail "eslint errors:"
        printf '%s\n' "$OUT" | grep -E 'Error' | head -20 | sed 's/^/         /'
      else
        pass "eslint clean"
      fi
    fi
  fi
fi
[ "$DEAD_RUN" -eq 0 ] && warn "no dead-code tooling installed (run scripts/install.sh)"

# ---------------------------------------------------------------- 7. Solidity
head_ "Solidity"
if command -v forge >/dev/null 2>&1 && exists "foundry.toml"; then
  if ! forge build --sizes >/dev/null 2>&1; then
    fail "forge build failed:"
    forge build 2>&1 | tail -20 | sed 's/^/         /'
  else
    pass "forge build"
  fi
  if ! forge fmt --check >/dev/null 2>&1; then
    fail "forge fmt --check failed. Run: forge fmt"
  else
    pass "forge fmt"
  fi
  if ! forge test >/dev/null 2>&1; then
    fail "forge test failed:"
    forge test 2>&1 | tail -30 | sed 's/^/         /'
  else
    pass "forge test"
  fi
  # Contracts with no corresponding test file
  for f in $(sol_files); do
    base=$(basename "$f" .sol)
    if ! ls test/ 2>/dev/null | grep -qi "^${base}\.t\.sol$"; then
      warn "contracts/$base.sol has no test/$base.t.sol"
    fi
  done
else
  [ -f "foundry.toml" ] && warn "forge not on PATH — install Foundry (see scripts/install.sh)"
fi

# ---------------------------------------------------------------- 8. TS build + format
head_ "TypeScript"
if exists "package.json"; then
  if npx --no-install tsc --version >/dev/null 2>&1 && exists "tsconfig.json"; then
    OUT=$(npx --no-install tsc --noEmit 2>&1 || true)
    if present "$OUT"; then
      fail "tsc type errors:"
      printf '%s\n' "$OUT" | head -20 | sed 's/^/         /'
    else
      pass "tsc --noEmit"
    fi
  fi
  if npx --no-install prettier --version >/dev/null 2>&1; then
    TSF=$(ts_all | tr '\n' ' ')
    if present "$TSF" && ! npx --no-install prettier --check $TSF >/dev/null 2>&1; then
      fail "prettier --check failed. Run: npx prettier --write ."
    else
      pass "prettier"
    fi
  fi
fi

# ---------------------------------------------------------------- 9. diff size
head_ "Scope"
if [ "$STAGED_ONLY" -eq 1 ]; then
  LINES=$(git diff --cached --numstat | awk '{a+=$1+$2} END{print a+0}')
else
  LINES=$(git diff --numstat HEAD | awk '{a+=$1+$2} END{print a+0}')
fi
if [ "$LINES" -gt 800 ]; then
  warn "$LINES lines changed — that is more than one feature. Consider splitting."
else
  pass "$LINES lines changed"
fi

# ---------------------------------------------------------------- verdict
printf '\n'
if [ "$FAILURES" -gt 0 ]; then
  printf '%s BLOCKED %s  %d failure(s), %d warning(s)\n' "$RED" "$RST" "$FAILURES" "$WARNINGS"
  printf '  Fix the failures above, then run the gate again.\n\n'
  rm -f "$STAMP_DIR/gate-pass"
  exit 1
fi

mkdir -p "$STAMP_DIR"
git rev-parse HEAD > "$STAMP_DIR/gate-pass" 2>/dev/null || true
printf '%s PASSED %s  %d warning(s). Safe to push.\n\n' "$GRN" "$RST" "$WARNINGS"
exit 0
