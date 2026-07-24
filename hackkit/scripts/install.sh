#!/usr/bin/env bash
# Run once per laptop, from the repo root:  bash scripts/install.sh
set -uo pipefail

GRN=$'\033[32m'; RED=$'\033[31m'; YLW=$'\033[33m'; BLD=$'\033[1m'; RST=$'\033[0m'
step() { printf '\n%s>> %s%s\n' "$BLD" "$1" "$RST"; }
ok()   { printf '%s  ok%s  %s\n' "$GRN" "$RST" "$1"; }
bad()  { printf '%s  !!%s  %s\n' "$RED" "$RST" "$1"; }
note() { printf '%s  ..%s  %s\n' "$YLW" "$RST" "$1"; }

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

printf '%s\nHackathon environment setup%s\n' "$BLD" "$RST"

# ---------------------------------------------------------------- platform
step "Platform"
case "$(uname -s)" in
  Darwin) ok "macOS" ;;
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      ok "WSL"
      case "$(pwd)" in
        /mnt/[a-z]/*)
          bad "This repo lives on the Windows filesystem ($(pwd))."
          echo "       That is slow and breaks file watching. Move it into WSL:"
          echo "         cp -r \"$(pwd)\" ~/ && cd ~/$(basename "$(pwd)")"
          ;;
        *) ok "repo is on the WSL filesystem" ;;
      esac
    else
      ok "Linux"
    fi
    ;;
  *) bad "Unsupported shell environment. On Windows, run this inside WSL, not PowerShell." ; exit 1 ;;
esac

# ---------------------------------------------------------------- deps
step "Required tools"

if command -v python3 >/dev/null 2>&1; then
  ok "python3 $(python3 --version 2>&1 | cut -d" " -f2)"
else
  bad "python3 missing — the Claude Code hooks need it"
  echo "       macOS:  brew install python3"
  echo "       WSL:    sudo apt-get install -y python3"
fi

if command -v node >/dev/null 2>&1; then
  V=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$V" -ge 20 ]; then ok "node $(node -v)"; else bad "node $(node -v) — need 20+"; fi
else
  bad "node missing — install Node 20 LTS via nvm"
fi

if command -v forge >/dev/null 2>&1; then ok "forge $(forge --version 2>/dev/null | head -1)"; else
  note "forge missing — installing Foundry"
  curl -L https://foundry.paradigm.xyz | bash 2>/dev/null || bad "Foundry install failed, do it manually"
  export PATH="$PATH:$HOME/.foundry/bin"
  "$HOME/.foundry/bin/foundryup" 2>/dev/null || note "run 'foundryup' after restarting your shell"
fi

if command -v gh >/dev/null 2>&1; then
  ok "gh"
  gh auth status >/dev/null 2>&1 || note "gh not authenticated — run: gh auth login"
else
  note "gh (GitHub CLI) missing — PRs will need to be opened in the browser"
fi

if command -v claude >/dev/null 2>&1; then ok "claude code"; else
  bad "Claude Code missing — install: npm install -g @anthropic-ai/claude-code"
fi

# ---------------------------------------------------------------- git hooks
step "Git hooks"
git config core.hooksPath .githooks
chmod +x .githooks/* 2>/dev/null || true
chmod +x .claude/hooks/*.sh scripts/*.sh 2>/dev/null || true
ok "core.hooksPath -> .githooks (commit-msg, pre-commit, pre-push active)"

# ---------------------------------------------------------------- node deps
step "Project dependencies"
if [ -f package.json ]; then
  npm install --silent 2>/dev/null && ok "npm install" || bad "npm install failed"
else
  note "no package.json yet"
fi

if [ -f foundry.toml ]; then
  forge install --no-commit >/dev/null 2>&1 && ok "forge install" || note "forge install skipped"
  forge build >/dev/null 2>&1 && ok "forge build" || note "forge build failed — normal if contracts are empty"
fi

# ---------------------------------------------------------------- env
step "Environment file"
if [ -f .env ]; then
  ok ".env exists"
else
  if [ -f .env.example ]; then
    cp .env.example .env
    ok "created .env from .env.example"
    note "fill in your own Hedera testnet ECDSA key from portal.hedera.com"
  else
    note "no .env.example found"
  fi
fi
grep -qxF '.env' .gitignore 2>/dev/null || { echo '.env' >> .gitignore; ok "added .env to .gitignore"; }

# ---------------------------------------------------------------- superpowers
step "Claude Code superpowers plugin"
cat <<'EOS'
  Not installable from a script — run this inside a Claude Code session:

      /plugin install superpowers@claude-plugins-official

  Then restart the session. Verify with /help that the skills are listed.
EOS

# ---------------------------------------------------------------- done
step "Done"
cat <<'EOS'
  Start work:

      claude

  Then describe ONE feature you want to build. When it works:

      /ship-feature      gate, commit, push, open PR
      /new-session       write handoff, then open a fresh terminal

  If anything breaks:

      /hedera-setup

EOS
