// Hedera Testnet primitives, replicated from scripts/setup-hedera-accounts.ts
// and packages/provider/src/registry.ts (those live as a script + non-exported
// helper, so we re-implement the exact same SDK calls rather than import them).

import {
  Client,
  AccountId,
  PrivateKey,
  Hbar,
  AccountCreateTransaction,
  TransferTransaction,
} from "@hiero-ledger/sdk";
import { readEnvVar } from "./envStore.js";
import { ProvisionError } from "./errors.js";

export interface Operator {
  id: string;
  key: string;
}

export function getOperator(): Operator {
  const id = readEnvVar("HEDERA_OPERATOR_ID");
  const key = readEnvVar("HEDERA_OPERATOR_KEY");
  if (!id || !key) {
    throw new ProvisionError(
      "OPERATOR_MISSING",
      "HEDERA_OPERATOR_ID / HEDERA_OPERATOR_KEY are not set",
      "Add a funded Hedera Testnet operator to .env (create one at https://portal.hedera.com).",
    );
  }
  return { id, key };
}

function clientFor(id: string, key: string): Client {
  return Client.forTestnet().setOperator(AccountId.fromString(id), PrivateKey.fromStringECDSA(key));
}

export function operatorClient(): Client {
  const op = getOperator();
  return clientFor(op.id, op.key);
}

/** Create + fund an ECDSA account from the operator. Returns id + the 0x-prefixed
 *  raw private key + the EVM address, exactly as setup-hedera-accounts.ts writes them. */
export async function createAndFundAccount(
  initialHbar: number,
): Promise<{ id: string; key: string; evm: string }> {
  const client = operatorClient();
  try {
    const key = PrivateKey.generateECDSA();
    const receipt = await (
      await new AccountCreateTransaction()
        .setECDSAKeyWithAlias(key.publicKey)
        .setInitialBalance(new Hbar(initialHbar))
        .execute(client)
    ).getReceipt(client);
    const id = receipt.accountId!.toString();
    return {
      id,
      key: `0x${key.toStringRaw()}`,
      evm: `0x${key.publicKey.toEvmAddress()}`,
    };
  } finally {
    client.close();
  }
}

/** Move `stakeHbar` from the provider account to the escrow account. The provider
 *  account signs (it's staking its own collateral). Returns the transfer tx id. */
export async function stakeToEscrow(
  providerId: string,
  providerKey: string,
  escrowId: string,
  stakeHbar: number,
): Promise<string> {
  const client = clientFor(providerId, providerKey);
  try {
    const tx = await new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(providerId), new Hbar(-stakeHbar))
      .addHbarTransfer(AccountId.fromString(escrowId), new Hbar(stakeHbar))
      .execute(client);
    await tx.getReceipt(client);
    return tx.transactionId!.toString();
  } finally {
    client.close();
  }
}
