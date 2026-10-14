import { and, eq, sql } from "drizzle-orm";
import { cloudDb } from "../../db/client";
import {
  betterAuthCreditAccount as accounts,
  betterAuthCreditLedger as ledger,
} from "../../db/betterAuthSchema";

type Customer = {
  customerType: "team" | "user";
  customerId: string;
  itemId: string;
};
type Operation = Customer & {
  operationKey: string;
  amount: number;
  vmId?: string;
  kind: "grant" | "reserve" | "refund";
  originalOperationKey?: string;
};
type Transaction = Parameters<
  Parameters<ReturnType<typeof cloudDb>["transaction"]>[0]
>[0];
type Account = typeof accounts.$inferSelect;
async function lockedAccount(
  tx: Transaction,
  input: Customer,
): Promise<Account> {
  const key = `credit:${input.customerType}:${input.customerId}:${input.itemId}`;
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
  await tx
    .insert(accounts)
    .values({
      customerType: input.customerType,
      customerId: input.customerId,
      itemId: input.itemId,
    })
    .onConflictDoNothing();
  const [account] = await tx
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.customerType, input.customerType),
        eq(accounts.customerId, input.customerId),
        eq(accounts.itemId, input.itemId),
      ),
    )
    .for("update");
  if (!account) throw new Error("Credit account disappeared");
  return account;
}
async function replayed(
  tx: Transaction,
  input: Operation,
  account: Account,
): Promise<boolean> {
  const [existing] = await tx
    .select()
    .from(ledger)
    .where(eq(ledger.operationKey, input.operationKey))
    .limit(1);
  if (!existing) return false;
  if (
    existing.accountId !== account.id ||
    existing.kind !== input.kind ||
    existing.amount !== input.amount ||
    existing.vmId !== (input.vmId ?? null) ||
    existing.originalOperationKey !== (input.originalOperationKey ?? null)
  )
    throw new Error(
      "Credit idempotency key conflicts with an existing operation",
    );
  return true;
}
async function alreadyRefunded(
  tx: Transaction,
  input: Operation,
  account: Account,
): Promise<boolean> {
  if (input.kind !== "refund") return false;
  if (!input.originalOperationKey)
    throw new Error("Refund must name its reservation");
  const [reserved] = await tx
    .select()
    .from(ledger)
    .where(eq(ledger.operationKey, input.originalOperationKey))
    .limit(1);
  if (
    !reserved ||
    reserved.kind !== "reserve" ||
    reserved.accountId !== account.id ||
    reserved.amount !== input.amount ||
    reserved.vmId !== (input.vmId ?? null)
  )
    throw new Error("Refund does not match its reservation");
  const [refund] = await tx
    .select()
    .from(ledger)
    .where(eq(ledger.originalOperationKey, input.originalOperationKey))
    .limit(1);
  return !!refund;
}
/** One account lock serializes balance and insert-first idempotency together. */
export async function applyCreditLedgerOperation(
  input: Operation,
): Promise<boolean> {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0)
    throw new Error("Credit amount must be a positive integer");
  if (!input.operationKey) throw new Error("Credit operation key is required");
  return cloudDb().transaction(async (tx) => {
    const account = await lockedAccount(tx, input);
    if (
      (await replayed(tx, input, account)) ||
      (await alreadyRefunded(tx, input, account))
    )
      return true;
    if (input.kind === "reserve" && account.balance < input.amount)
      return false;
    await tx
      .insert(ledger)
      .values({
        accountId: account.id,
        operationKey: input.operationKey,
        kind: input.kind,
        amount: input.amount,
        vmId: input.vmId ?? null,
        originalOperationKey: input.originalOperationKey ?? null,
      });
    const balance =
      input.kind === "reserve"
        ? account.balance - input.amount
        : account.balance + input.amount;
    if (!Number.isSafeInteger(balance))
      throw new Error("Credit balance overflow");
    await tx
      .update(accounts)
      .set({ balance, updatedAt: new Date() })
      .where(eq(accounts.id, account.id));
    return true;
  });
}
