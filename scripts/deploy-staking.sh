#!/usr/bin/env bash
# Deploys Staking.sol to Base Sepolia and writes the address into deployments.json.
# Requires: EXCHANGE_PK funded with Base Sepolia ETH; foundry on PATH.
set -euo pipefail
cd "$(dirname "$0")/../contracts"

source ../.env
export VERIFIER_ADDRESS=$(cast wallet address --private-key "$VERIFIER_PK")

echo "Deploying Staking (verifier=$VERIFIER_ADDRESS)..."
OUT=$(forge script script/Deploy.s.sol --rpc-url "${RPC_URL:-https://sepolia.base.org}" \
  --private-key "$EXCHANGE_PK" --broadcast 2>&1)
echo "$OUT" | tail -20
ADDR=$(echo "$OUT" | grep -o 'STAKING_ADDRESS=0x[0-9a-fA-F]*' | cut -d= -f2)
[ -n "$ADDR" ] || { echo "deploy failed"; exit 1; }

node -e "
const fs=require('fs');const p='../deployments.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.baseSepolia.staking='$ADDR';
fs.writeFileSync(p,JSON.stringify(j,null,2));
console.log('deployments.json updated: staking='+'$ADDR');
"
