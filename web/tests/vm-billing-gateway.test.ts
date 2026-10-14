import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as Effect from "effect/Effect";
import { VmCreateCreditsInsufficientError } from "../services/vms/errors";
const operations: unknown[] = [];
let sufficient = true;
mock.module("../services/vms/creditLedger", () => ({ applyCreditLedgerOperation: async (input: unknown) => { operations.push(input); return sufficient; } }));
const { makeOwnedVmBillingGateway, DEFAULT_FREE_CREATE_CREDIT_ITEM_ID } = await import("../services/vms/billingGateway");
const input = { userId: "user-1", billingCustomerType: "team" as const, billingTeamId: "org-1", billingPlanId: "free", provider: "freestyle" as const, image: "test", vmId: "83b2a08c-a00a-4d89-886d-b812cd59ca61" };
beforeEach(() => { operations.length = 0; sufficient = true; });
describe("owned VM create credits", () => {
  test("free accounts receive twenty create credits without provider configuration", () => {
    expect(makeOwnedVmBillingGateway({}).resolveInitialCreateCreditGrant(input)).toEqual({ kind: "owned_credit", itemId: DEFAULT_FREE_CREATE_CREDIT_ITEM_ID, customerType: "team", customerId: "org-1", amount: 20, reason: "free-plan-initial-create-credits" });
    expect(makeOwnedVmBillingGateway({}).resolveInitialCreateCreditGrant({ ...input, billingPlanId: "pro" })).toEqual({ kind: "none" });
  });
  test("grant and reserve use stable operation identities, and refund names the reservation", async () => {
    const gateway = makeOwnedVmBillingGateway({});
    await Effect.runPromise(gateway.applyCreateCreditGrant(gateway.resolveInitialCreateCreditGrant(input)));
    const reservation = await Effect.runPromise(gateway.reserveCreate(input));
    expect(reservation).toMatchObject({ kind: "owned_credit", customerId: "org-1", amount: 1, vmId: input.vmId });
    await Effect.runPromise(gateway.refundCreate(reservation));
    expect(operations).toMatchObject([{ kind: "grant", amount: 20, operationKey: "grant:team:org-1:cmux-vm-create-credit:free-plan-initial-create-credits" }, { kind: "reserve", vmId: input.vmId, operationKey: `reserve:team:org-1:cmux-vm-create-credit:${input.vmId}` }, { kind: "refund", originalOperationKey: `reserve:team:org-1:cmux-vm-create-credit:${input.vmId}` }]);
  });
  test("insufficient owned balance preserves the payment refusal", async () => {
    sufficient = false;
    const result = await Effect.runPromise(Effect.either(makeOwnedVmBillingGateway({}).reserveCreate(input)));
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left).toBeInstanceOf(VmCreateCreditsInsufficientError);
  });
  test("explicit credit disabling applies only to the configured plan", async () => {
    const gateway = makeOwnedVmBillingGateway({ CMUX_VM_PLAN_FREE_CREATE_CREDIT_ITEM_ID: "disabled" });
    expect(await Effect.runPromise(gateway.reserveCreate(input))).toEqual({ kind: "none" });
    expect(operations).toHaveLength(0);
  });
  test("user billing and provider-specific cost stay scoped to their configured account", async () => {
    const gateway = makeOwnedVmBillingGateway({ CMUX_VM_PLAN_FREE_CREATE_CREDIT_COST_FREESTYLE: "3" });
    await Effect.runPromise(gateway.reserveCreate({ ...input, billingCustomerType: "user" }));
    expect(operations[0]).toMatchObject({ customerType: "user", customerId: "user-1", amount: 3 });
  });
});
