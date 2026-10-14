import { AsyncLocalStorage } from "node:async_hooks";
import type { cloudDb } from "./client";

type Transaction = Parameters<Parameters<ReturnType<typeof cloudDb>["transaction"]>[0]>[0];
type Scope = { readonly transaction: Transaction; active: boolean };
const transactionStorage = new AsyncLocalStorage<Scope>();

export class CloudDbTransactionClosedError extends Error {
  override readonly name = "CloudDbTransactionClosedError";
  constructor() { super("Database transaction scope has closed"); }
}

/** The lock owner supplies its transaction; nested service queries reuse that connection. */
export async function withCloudDbTransaction<T>(transaction: Transaction, operation: () => Promise<T>): Promise<T> {
  const scope: Scope = { transaction, active: true };
  return transactionStorage.run(scope, async () => {
    try { return await operation(); }
    finally { scope.active = false; }
  });
}

/** Escaped async work must fail rather than mutate through a fresh pooled connection. */
export function currentCloudDbTransaction(): Transaction | undefined {
  const scope = transactionStorage.getStore();
  if (!scope) return undefined;
  if (!scope.active) throw new CloudDbTransactionClosedError();
  return scope.transaction;
}
