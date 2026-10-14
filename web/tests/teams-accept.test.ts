import { ownedPrincipal } from "./helpers/owned-principal";
import { betterAuthInvitation, betterAuthOrganization, betterAuthMember } from "../db/betterAuthSchema";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { acceptTeamInvitationCode } from "../services/teams/accept";
import { TeamApiError, TeamServiceUnavailableError } from "../services/teams/errors";
import { createInvitationCodeClient, type InvitationCodeClient } from "../services/teams/invitationCode";
import { ADMIN_ID, MemoryInviteStore, MemoryTeamSeatSync, OUTSIDER_ID, standardTeam, TEAM_ID } from "./teams-fixture";

let invitationPrincipal = await ownedPrincipal({ id: OUTSIDER_ID, primaryEmail: "invitee@example.com" });
let invitationRow: { id: string; organizationId: string; email: string; role: string; status: string; expiresAt: Date } | null = null;
let invitationDbError: Error | null = null;
let invitationDbCalls = 0;
let acceptedMembers: unknown[] = [];
const invitationDb = {
  select(projection?: unknown) {
    let table: unknown;
    const query = {
      from(value: unknown) { table = value; return query; },
      innerJoin() { return query; }, where() { return query; }, limit() { return query; }, for() { return query; },
      then(resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) {
        invitationDbCalls += 1;
        if (invitationDbError) return Promise.reject(invitationDbError).then(resolve, reject);
        const rows = table === betterAuthInvitation
          ? invitationRow ? [projection ? { invitation: invitationRow, name: "Acme" } : invitationRow] : []
          : table === betterAuthOrganization ? [{ clientReadOnlyMetadata: { cmuxPlan: "pro", cmuxSeats: 3 } }]
          : table === betterAuthMember ? [{ organizationId: TEAM_ID, userId: ADMIN_ID, role: "owner" }] : [];
        return Promise.resolve(rows).then(resolve, reject);
      },
    };
    return query;
  },
  transaction: async (run: (tx: unknown) => Promise<unknown>) => run(invitationDb),
  execute: async () => {},
  insert: () => ({ values: (row: unknown) => ({ onConflictDoNothing: async () => { acceptedMembers.push(row); } }) }),
  update: () => ({ set: (changes: { status: string }) => ({ where: async () => { if (invitationRow) invitationRow.status = changes.status; } }) }),
};
mock.module("../db/client", () => ({ cloudDb: () => invitationDb }));
mock.module("../services/auth/betterAuthPrincipal", () => ({ resolveBetterAuthPrincipal: async () => invitationPrincipal }));

const INVITEE_EMAIL = "invitee@example.com";

/** Stack's code endpoints: `details` names the team, `accept` consumes one invitation. */
function codeClient(input: {
  teamId?: string;
  onAccept?: () => void;
  detailsFailure?: "email_mismatch" | "invalid" | "unavailable";
  acceptFailure?: "email_mismatch" | "invalid" | "unavailable";
}): InvitationCodeClient & { tokens: string[] } {
  const tokens: string[] = [];
  return {
    tokens,
    async details(_code, accessToken) {
      tokens.push(accessToken);
      if (input.detailsFailure) return { ok: false, failure: input.detailsFailure };
      return { ok: true, value: { teamId: input.teamId ?? TEAM_ID, teamDisplayName: "Acme" } };
    },
    async accept(_code, accessToken) {
      tokens.push(accessToken);
      if (input.acceptFailure) return { ok: false, failure: input.acceptFailure };
      input.onAccept?.();
      return { ok: true, value: null };
    },
  };
}

function inviteeStack() {
  const stack = standardTeam();
  stack.users.set(OUTSIDER_ID, {
    id: OUTSIDER_ID,
    email: INVITEE_EMAIL,
    verifiedEmails: [INVITEE_EMAIL, "second@example.com"],
    selectedTeamId: null,
  });
  return stack;
}

function acceptRequest(): Request {
  return new Request("https://cmux.test/api/teams/accept", {
    method: "POST",
    headers: { authorization: "Bearer native-access", "x-stack-refresh-token": "native-refresh" },
  });
}

/** A stored role as cmux leaves it after sending: bound to the invitation it went out with. */
async function storeWithRole(email: string, role: "admin" | "member", stackInvitationId: string) {
  const store = new MemoryInviteStore();
  await store.upsertInviteRole({ stackTeamId: TEAM_ID, email, role, invitedByUserId: ADMIN_ID });
  await store.bindInviteRoleInvitation(TEAM_ID, email, stackInvitationId);
  return store;
}

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof TeamApiError) return `${error.status}:${error.code}`;
    if (error instanceof TeamServiceUnavailableError) return "503:service_unavailable";
    throw error;
  }
  return "ok";
}

describe("accepting an email invitation", () => {
  test("applies a stored admin role on the exact team and consumes the role row", async () => {
    const stack = inviteeStack();
    const invitation = stack.addInvitation(TEAM_ID, INVITEE_EMAIL);
    const store = await storeWithRole(INVITEE_EMAIL, "admin", invitation.id);
    const codes = codeClient({ onAccept: () => stack.consumeInvitation(invitation.id, OUTSIDER_ID) });

    const result = await acceptTeamInvitationCode(acceptRequest(), OUTSIDER_ID, "code", { stack: stack.app(), codes, store, seats: new MemoryTeamSeatSync() });

    expect(result).toEqual({ teamId: TEAM_ID, role: "admin" });
    expect(stack.grantsOf(TEAM_ID, OUTSIDER_ID).has("team_admin")).toBe(true);
    expect(store.roles.size).toBe(0);
    expect(stack.users.get(OUTSIDER_ID)!.selectedTeamId).toBe(TEAM_ID);
    // The caller's authoritative token, never a server credential, uses the code.
    expect(codes.tokens).toEqual(["caller-access-token", "caller-access-token"]);
  });

  test("defaults to member when no role was stored", async () => {
    const stack = inviteeStack();
    const invitation = stack.addInvitation(TEAM_ID, INVITEE_EMAIL);
    const codes = codeClient({ onAccept: () => stack.consumeInvitation(invitation.id, OUTSIDER_ID) });
    const result = await acceptTeamInvitationCode(acceptRequest(), OUTSIDER_ID, "code", {
      stack: stack.app(),
      codes,
      store: new MemoryInviteStore(),
    });
    expect(result.role).toBe("member");
    expect(stack.calls.some((call) => call.startsWith("grant:"))).toBe(false);
  });

  test("picks the consumed invitation when the user has two pending ones", async () => {
    const stack = inviteeStack();
    const second = stack.addInvitation(TEAM_ID, "second@example.com");
    const consumed = stack.addInvitation(TEAM_ID, INVITEE_EMAIL);
    const store = await storeWithRole("second@example.com", "admin", second.id);
    await store.upsertInviteRole({ stackTeamId: TEAM_ID, email: INVITEE_EMAIL, role: "member", invitedByUserId: ADMIN_ID });
    const codes = codeClient({ onAccept: () => stack.consumeInvitation(consumed.id, OUTSIDER_ID) });

    const result = await acceptTeamInvitationCode(acceptRequest(), OUTSIDER_ID, "code", { stack: stack.app(), codes, store, seats: new MemoryTeamSeatSync() });

    // The admin invitation to the other address was not the one used.
    expect(result.role).toBe("member");
    expect(stack.grantsOf(TEAM_ID, OUTSIDER_ID).has("team_admin")).toBe(false);
    expect(store.roles.has(`${TEAM_ID}:second@example.com`)).toBe(true);
  });

  test("an unidentifiable consumed invitation never escalates", async () => {
    const stack = inviteeStack();
    const pending = stack.addInvitation(TEAM_ID, INVITEE_EMAIL);
    const store = await storeWithRole(INVITEE_EMAIL, "admin", pending.id);
    // Stack added the member but the invitation list did not change.
    const codes = codeClient({
      onAccept: () => {
        stack.teams.get(TEAM_ID)!.members.add(OUTSIDER_ID);
      },
    });
    const result = await acceptTeamInvitationCode(acceptRequest(), OUTSIDER_ID, "code", { stack: stack.app(), codes, store, seats: new MemoryTeamSeatSync() });
    expect(result.role).toBe("member");
    expect(stack.grantsOf(TEAM_ID, OUTSIDER_ID).has("team_admin")).toBe(false);
  });

  test("an admin role stored on another team is not applied", async () => {
    const stack = inviteeStack();
    const invitation = stack.addInvitation(TEAM_ID, INVITEE_EMAIL);
    const store = new MemoryInviteStore();
    await store.upsertInviteRole({
      stackTeamId: "99999999-9999-4999-8999-999999999999",
      email: INVITEE_EMAIL,
      role: "admin",
      invitedByUserId: ADMIN_ID,
    });
    const codes = codeClient({ onAccept: () => stack.consumeInvitation(invitation.id, OUTSIDER_ID) });
    const result = await acceptTeamInvitationCode(acceptRequest(), OUTSIDER_ID, "code", { stack: stack.app(), codes, store, seats: new MemoryTeamSeatSync() });
    expect(result.role).toBe("member");
  });

  test("maps Stack code failures to 409 email_mismatch and 410 invitation_invalid", async () => {
    const stack = inviteeStack();
    const store = new MemoryInviteStore();
    const run = (codes: InvitationCodeClient) =>
      failure(acceptTeamInvitationCode(acceptRequest(), OUTSIDER_ID, "code", { stack: stack.app(), codes, store, seats: new MemoryTeamSeatSync() }));
    expect(await run(codeClient({ detailsFailure: "email_mismatch" }))).toBe("409:email_mismatch");
    expect(await run(codeClient({ detailsFailure: "invalid" }))).toBe("410:invitation_invalid");
    expect(await run(codeClient({ acceptFailure: "invalid" }))).toBe("410:invitation_invalid");
    expect(await run(codeClient({ acceptFailure: "unavailable" }))).toBe("503:service_unavailable");
    expect(await run(codeClient({ teamId: "99999999-9999-4999-8999-999999999999" }))).toBe("410:invitation_invalid");
  });

  test("refuses to grant when Stack did not actually add the member", async () => {
    const stack = inviteeStack();
    const pending = stack.addInvitation(TEAM_ID, INVITEE_EMAIL);
    const store = await storeWithRole(INVITEE_EMAIL, "admin", pending.id);
    const codes = codeClient({});
    expect(await failure(acceptTeamInvitationCode(acceptRequest(), OUTSIDER_ID, "code", { stack: stack.app(), codes, store, seats: new MemoryTeamSeatSync() })))
      .toBe("503:service_unavailable");
    expect(stack.grantsOf(TEAM_ID, OUTSIDER_ID).has("team_admin")).toBe(false);
  });

  test("a session without an access token is unauthorized", async () => {
    const stack = inviteeStack();
    stack.accessToken = null;
    expect(await failure(acceptTeamInvitationCode(acceptRequest(), OUTSIDER_ID, "code", {
      stack: stack.app(),
      codes: codeClient({}),
      store: new MemoryInviteStore(),
    }))).toBe("401:unauthorized");
  });
});

describe("owned organization invitation-code client", () => {
  const code = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  beforeEach(async () => {
    invitationPrincipal = await ownedPrincipal({ id: OUTSIDER_ID, primaryEmail: INVITEE_EMAIL });
    invitationRow = { id: code, organizationId: TEAM_ID, email: INVITEE_EMAIL, role: "admin", status: "pending", expiresAt: new Date(Date.now() + 60_000) };
    invitationDbError = null;
    invitationDbCalls = 0;
    acceptedMembers = [];
  });

  test("reads the organization name and ID from the owned invitation without contacting a legacy endpoint", async () => {
    const legacyFetch = mock(async () => { throw new Error("legacy endpoint forbidden"); });
    const client = createInvitationCodeClient({ fetch: legacyFetch });
    expect(await client.details(code, "owned-token")).toEqual({ ok: true, value: { teamId: TEAM_ID, teamDisplayName: "Acme" } });
    expect(legacyFetch).not.toHaveBeenCalled();
    expect(invitationDbCalls).toBe(1);
  });

  test("accepts the invitation for the current verified identity and preserves its admin role", async () => {
    const client = createInvitationCodeClient();
    expect(await client.accept(code, "owned-token")).toEqual({ ok: true, value: null });
    expect(acceptedMembers).toHaveLength(1);
    expect(acceptedMembers[0]).toMatchObject({ organizationId: TEAM_ID, userId: OUTSIDER_ID, role: "admin" });
    expect(invitationRow?.status).toBe("accepted");
    expect(await client.accept(code, "owned-token")).toEqual({ ok: false, failure: "invalid" });
  });

  test("maps a mailbox mismatch and never grants membership", async () => {
    invitationPrincipal = await ownedPrincipal({ id: OUTSIDER_ID, primaryEmail: "different@example.com" });
    const client = createInvitationCodeClient();
    expect(await client.details(code, "owned-token")).toEqual({ ok: false, failure: "email_mismatch" });
    expect(await client.accept(code, "owned-token")).toEqual({ ok: false, failure: "email_mismatch" });
    expect(acceptedMembers).toEqual([]);
  });

  test("refuses malformed, missing, expired and consumed invitations", async () => {
    const client = createInvitationCodeClient();
    expect(await client.details("legacy-code", "owned-token")).toEqual({ ok: false, failure: "invalid" });
    expect(invitationDbCalls).toBe(0);
    invitationRow!.expiresAt = new Date(0);
    expect(await client.details(code, "owned-token")).toEqual({ ok: false, failure: "invalid" });
    invitationRow!.expiresAt = new Date(Date.now() + 60_000);
    invitationRow!.status = "accepted";
    expect(await client.details(code, "owned-token")).toEqual({ ok: false, failure: "invalid" });
    invitationRow = null;
    expect(await client.details(code, "owned-token")).toEqual({ ok: false, failure: "invalid" });
  });

  test("an owned store failure is unavailable, not an invalid invitation", async () => {
    invitationDbError = new Error("database unavailable");
    expect(await createInvitationCodeClient().accept(code, "owned-token")).toEqual({ ok: false, failure: "unavailable" });
    expect(acceptedMembers).toEqual([]);
  });
});
