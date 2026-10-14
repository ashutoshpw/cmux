import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cloudDb } from "../db/client";
import { betterAuthCreditAccount, betterAuthCreditLedger } from "../db/betterAuthSchema";
import { applyCreditLedgerOperation } from "../services/vms/creditLedger";
const dbTest = process.env.CMUX_DB_TEST === "1" ? test : test.skip;
describe("owned credit ledger database behavior", () => {
  dbTest("concurrent reservations never overspend and retry/refund never duplicate credits", async () => {
    const customerId = randomUUID(); const customer = { customerType: "user" as const, customerId, itemId: "test-create-credit" }; const grantKey = `grant:${customerId}`;
    const balance = async () => (await cloudDb().select().from(betterAuthCreditAccount).where(and(eq(betterAuthCreditAccount.customerId, customerId), eq(betterAuthCreditAccount.itemId, customer.itemId))))[0]!.balance;
    try {
      const grant = { ...customer, kind: "grant" as const, amount: 20, operationKey: grantKey };
      await Promise.all([applyCreditLedgerOperation(grant), applyCreditLedgerOperation(grant)]);
      expect(await balance()).toBe(20);
      const reservations = [0, 1].map((index) => ({ ...customer, kind: "reserve" as const, amount: 15, vmId: randomUUID(), operationKey: `reserve:${customerId}:${index}` }));
      const results = await Promise.all(reservations.map(applyCreditLedgerOperation));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await balance()).toBe(5);
      const reserved = reservations[results.indexOf(true)]!;
      expect(await applyCreditLedgerOperation(reserved)).toBe(true);
      expect(await balance()).toBe(5);
      const refund = { ...reserved, kind: "refund" as const, operationKey: `refund:${reserved.operationKey}`, originalOperationKey: reserved.operationKey };
      await Promise.all([applyCreditLedgerOperation(refund), applyCreditLedgerOperation(refund)]);
      expect(await balance()).toBe(20);
      await expect(applyCreditLedgerOperation({ ...refund, operationKey: `invalid:${customerId}`, amount: 16 })).rejects.toThrow("does not match");
      expect(await balance()).toBe(20);
      await expect(applyCreditLedgerOperation({ ...reserved, amount: 1 })).rejects.toThrow("conflicts");
    } finally {
      const [account] = await cloudDb().select().from(betterAuthCreditAccount).where(eq(betterAuthCreditAccount.customerId, customerId));
      if (account) { await cloudDb().delete(betterAuthCreditLedger).where(eq(betterAuthCreditLedger.accountId, account.id)); await cloudDb().delete(betterAuthCreditAccount).where(eq(betterAuthCreditAccount.id, account.id)); }
    }
  });
});
