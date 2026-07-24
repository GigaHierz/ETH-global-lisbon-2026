#!/usr/bin/env bash
# Environment diagnostic. Read-only — changes nothing.
set -uo pipefail
GRN=$'\033[32m'; RED=$'\033[31m'; YLW=$'\033[33m'; RST=$'\033[0m'
ok(){ printf '%s ok %s %s\n' "$GRN" "$RST" "$1"; }
no(){ printf '%s BAD%s %s\n' "$RED" "$RST" "$1"; }
hm(){ printf '%s  ? %s %s\n' "$YLW" "$RST" "$1"; }

echo "--- tools ---"
for t in python3 node npm git forge cast claude gh; do
  if command -v "$t" >/dev/null 2>&1; then ok "$t  $(command -v "$t")"; else no "$t missing"; fi
done

echo "--- versions ---"
command -v node >/dev/null && { V=$(node -v|sed 's/v//'|cut -d. -f1); [ "$V" -ge 20 ] && ok "node $(node -v)" || no "node $(node -v) — need 20+"; }
command -v forge >/dev/null && ok "$(forge --version 2>/dev/null|head -1)"

echo "--- platform ---"
if grep -qi microsoft /proc/version 2>/dev/null; then
  ok "WSL"
  case "$(pwd)" in /mnt/[a-z]/*) no "repo on Windows FS — move into ~ for speed";; *) ok "repo on WSL FS";; esac
else ok "$(uname -s)"; fi

echo "--- git ---"
HP=$(git config core.hooksPath 2>/dev/null || echo "")
[ "$HP" = ".githooks" ] && ok "hooksPath = .githooks" || no "hooksPath not set — run: bash scripts/install.sh"
B=$(git rev-parse --abbrev-ref HEAD 2>/dev/null||echo ?); ok "branch: $B"
D=$(git status --porcelain 2>/dev/null|wc -l|tr -d ' '); ok "uncommitted files: $D"
git remote -v | head -1 | grep -q . && ok "remote configured" || no "no git remote"

echo "--- env vars ---"
[ -f .env ] && ok ".env present" || no ".env missing — cp .env.example .env"
for v in HEDERA_RPC_URL HEDERA_ACCOUNT_ID; do
  ( set -a; [ -f .env ] && . ./.env 2>/dev/null; set +a
    [ -n "${!v:-}" ] && echo "  ok  $v is set" || echo "  ?   $v is empty" )
done
( set -a; [ -f .env ] && . ./.env 2>/dev/null; set +a
  if [ -n "${HEDERA_OPERATOR_KEY:-}${HEDERA_PRIVATE_KEY:-}" ]; then echo "  ok  private key is set (value not shown)"; else echo "  BAD private key not set"; fi )

echo "--- rpc ---"
( set -a; [ -f .env ] && . ./.env 2>/dev/null; set +a
  URL="${HEDERA_RPC_URL:-https://testnet.hashio.io/api}"
  if command -v cast >/dev/null 2>&1; then
    if BN=$(cast block-number --rpc-url "$URL" 2>/dev/null); then ok "relay reachable, block $BN"; else no "relay unreachable at $URL (Hashio is rate-limited; retry or use local node)"; fi
  else hm "cast not available, skipping RPC check"; fi )

echo "--- build ---"
[ -f foundry.toml ] && { forge build >/dev/null 2>&1 && ok "forge build" || no "forge build fails"; }
[ -f package.json ] && { [ -d node_modules ] && ok "node_modules present" || no "run npm install"; }
echo
