// 0G Storage — encrypted, tradeable agent memory.
//
// The buyer agent's call history is its memory. This module serializes that
// memory, encrypts it (AES-256, built into @0gfoundation/0g-storage-ts-sdk), and
// uploads it to 0G Storage, returning the Merkle root hash. That root becomes the
// intelligent-data pointer of the agent's Agentic ID (see packages/shared/zerog.ts
// mintAgenticId), so ownership of the ID carries ownership of the memory — the
// "tradeable memory via Agentic ID" the AI-product track asks for.
//
// Gated on ZEROG_CHAIN_KEY (a funded Galileo wallet) + ZEROG_MEMORY_SECRET (the
// encryption passphrase). Without both, every call is a no-op returning null, so
// the agent runs unchanged. ethers + the storage SDK are optional deps, loaded
// only on this path.

import { log } from "@agentrouter/shared";
import { createHash } from "node:crypto";

const RPC = process.env.ZEROG_CHAIN_RPC || "https://evmrpc-testnet.0g.ai";
const INDEXER = process.env.ZEROG_STORAGE_INDEXER || "https://indexer-storage-testnet-turbo.0g.ai";

function chainKey(): string | null {
  const k = process.env.ZEROG_CHAIN_KEY?.trim();
  return k ? (k.startsWith("0x") ? k : `0x${k}`) : null;
}

/** 32-byte AES key derived from ZEROG_MEMORY_SECRET. */
function memorySecret(): Uint8Array | null {
  const s = process.env.ZEROG_MEMORY_SECRET?.trim();
  if (!s) return null;
  return new Uint8Array(createHash("sha256").update(s).digest());
}

/** True when both a funded key and an encryption secret are present. */
export function zeroGStorageEnabled(): boolean {
  return !!(chainKey() && memorySecret());
}

/**
 * Encrypt + upload a memory payload to 0G Storage. Returns { rootHash, txHash }
 * or null when storage isn't configured. Throws only on a genuine upload error
 * (caller decides how loud to be).
 */
export async function uploadMemory(payload: unknown): Promise<{ rootHash: string; txHash: string } | null> {
  const key = chainKey();
  const secret = memorySecret();
  if (!key || !secret) return null;
  // @ts-ignore optional dependency — only present when 0G Storage is used
  const { ethers } = await import("ethers");
  // @ts-ignore optional dependency — only present when 0G Storage is used
  const { Indexer, MemData } = await import("@0gfoundation/0g-storage-ts-sdk");

  const provider = new ethers.JsonRpcProvider(RPC);
  const signer = new ethers.Wallet(key, provider);
  const indexer = new Indexer(INDEXER);

  const buf = Buffer.from(JSON.stringify(payload));
  const file = new MemData(new Uint8Array(buf));
  const [res, err] = await indexer.upload(file, RPC, signer, {
    encryption: { type: "aes256", key: secret },
    finalityRequired: true,
  });
  if (err) throw err;
  // Single-file upload returns { txHash, rootHash, txSeq }; narrow off the union.
  if (!res || !("rootHash" in res)) throw new Error("unexpected 0G Storage upload result");
  log("agent", `0G Storage memory uploaded — root ${res.rootHash.slice(0, 18)}…`);
  return { rootHash: res.rootHash, txHash: res.txHash };
}

/**
 * Download + decrypt a memory payload by root hash. Returns the parsed object,
 * or null when storage isn't configured.
 */
export async function downloadMemory(rootHash: string): Promise<unknown | null> {
  const secret = memorySecret();
  if (!secret) return null;
  // @ts-ignore optional dependency — only present when 0G Storage is used
  const { Indexer } = await import("@0gfoundation/0g-storage-ts-sdk");
  const indexer = new Indexer(INDEXER);
  const [blob, err] = await indexer.downloadToBlob(rootHash, {
    proof: true,
    decryption: { symmetricKey: secret },
  });
  if (err) throw err;
  const text = Buffer.from(await blob.arrayBuffer()).toString("utf8");
  return JSON.parse(text);
}
