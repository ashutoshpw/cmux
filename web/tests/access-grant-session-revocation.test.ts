import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { betterAuthSession } from "../db/betterAuthSchema";

// DELETE /api/vm/access-grants/[id] cuts the grant and its tunnels in our
// database, queues the Stack sessions that enrolled the Mac in the same
// transaction, then tries to revoke them. It used to revoke them through the
// caller's session inside `Promise.allSettled` and answer `{ revoked: true }`
// whatever Stack said, so a throttled revocation left the sessions alive with
// nothing to retry it.

const ENV_KEYS = [
  "SKIP_ENV_VALIDATION",
  "NEXT_PUBLIC_STACK_PROJECT_ID",
  "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY",
  "STACK_SECRET_SERVER_KEY",
  "STACK_API_BASE_URL",
  "CRON_SECRET",
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
Object.assign(process.env, {
  SKIP_ENV_VALIDATION: "1",
  NEXT_PUBLIC_STACK_PROJECT_ID: "00000000-0000-4000-8000-0000000000cc",
  NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: "pck_test",
  STACK_SECRET_SERVER_KEY: "ssk_test",
  STACK_API_BASE_URL: "https://stack.test",
  CRON_SECRET: "cron-secret",
});
afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const USER_ID = "grant-owner-1";
const GRANT_ID = "6f1f6f0e-8f5a-4d55-9a37-7f6c0b1a2c3d";
const SESSIONS = ["00000000-0000-4000-8000-00000000000a", "00000000-0000-4000-8000-00000000000b"];

const getUser = mock(async () => ({
  id: USER_ID,
  displayName: null,
  primaryEmail: "owner@example.com",
  selectedTeam: null,
  clientReadOnlyMetadata: {},
  listTeams: async () => Object.assign([], { nextCursor: null }),
}));
mock.module("../app/lib/stack", () => ({
  getStackServerApp: () => ({ getUser }),
  isStackConfigured: () => true,
  stackServerApp: { getUser },
}));

type MemoryRow = { stackSessionId: string; userId: string; attempts: number; nextAttemptAt: Date; claimedUntil: Date | null; createdAt: Date; gaveUpAt: Date | null };
const rows = new Map<string, MemoryRow>();
const workflowCalls: unknown[] = [];

// The grant revocation and the session queue are one transaction in the
// repository; here the workflow double does both, as the real one does.
mock.module("../services/vms/workflows", () => ({
  renameVmAccessGrant: () => ({ workflow: "rename" }),
  revokeVmAccessGrant: (input: unknown) => ({ workflow: "revoke", input }),
  reconcileVmProviderStatuses: () => ({ workflow: "reconcile" }),
  reapStaleVmTunnels: () => ({ workflow: "reap" }),
  runVmWorkflow: async () => ({}),
}));
mock.module("../services/vms/routeWorkflow", () => ({
  runVmRoute: async (workflow: { input: { revokeStackSessions?: { firstRetryAt: Date } } }) => {
    workflowCalls.push(workflow.input);
    for (const stackSessionId of SESSIONS) {
      rows.set(stackSessionId, {
        stackSessionId,
        userId: USER_ID,
        attempts: 0,
        nextAttemptAt: workflow.input.revokeStackSessions!.firstRetryAt,
        claimedUntil: null,
        createdAt: new Date(),
        gaveUpAt: null,
      });
    }
    return { ok: true, value: { revoked: true, accessGrantId: GRANT_ID, stackSessionIds: SESSIONS } };
  },
}));

mock.module("../services/vms/stackSessionRevocationStore", () => ({
  deleteStackSessionRevocationsForUser: async () => {},
  databaseStackSessionRevocationStore: () => ({
    claimDue: async (now: Date, limit: number, leaseUntil: Date) => {
      const due = [...rows.values()]
        .filter((row) => !row.gaveUpAt && row.nextAttemptAt <= now && (!row.claimedUntil || row.claimedUntil <= now))
        .slice(0, limit);
      for (const row of due) row.claimedUntil = leaseUntil;
      return due.map(({ stackSessionId, userId, attempts }) => ({ stackSessionId, userId, attempts }));
    },
    listOpen: async (ids: readonly string[]) => ids.flatMap((id) => {
      const row = rows.get(id);
      return row && !row.gaveUpAt ? [{ stackSessionId: row.stackSessionId, userId: row.userId, attempts: row.attempts }] : [];
    }),
    markRevoked: async (id: string) => { rows.delete(id); },
    recordFailure: async (id: string, input: { now: Date; policy: { baseDelayMs: number; maxAttempts: number } }) => {
      const row = rows.get(id);
      if (!row || row.gaveUpAt) return null;
      row.nextAttemptAt = new Date(input.now.getTime() + input.policy.baseDelayMs * 2 ** row.attempts);
      row.attempts += 1;
      row.claimedUntil = null;
      if (row.attempts >= input.policy.maxAttempts) row.gaveUpAt = input.now;
      return { attempts: row.attempts, gaveUp: row.gaveUpAt !== null };
    },
  }),
}));

mock.module("../services/auth/betterAuthPrincipal", () => ({
  resolveBetterAuthPrincipal: async () => ({ userId: USER_ID, displayName: "Owner", email: "owner@example.com", emailVerified: true, isAnonymous: false, clientReadOnlyMetadata: {}, sessionId: SESSIONS[0], sessionCreatedAt: new Date(0), organizations: [], activeOrganizationId: null }),
}));
const ownedSessionIds = new Set<string>();
const sessionDeletes: string[] = [];
mock.module("../db/client", () => ({
  cloudDb: () => ({ delete: (table: unknown) => ({ where: async (condition: SQL) => {
    expect(table).toBe(betterAuthSession);
    const sessionId = String(new PgDialect().sqlToQuery(condition).params[0]);
    sessionDeletes.push(sessionId);
    const answer = stackAnswers.shift() ?? 200;
    if (typeof answer !== "number" || answer !== 200) throw new Error("Owned database unavailable");
    ownedSessionIds.delete(sessionId);
  } }) }),
}));

const { DELETE } = await import("../app/api/vm/access-grants/[id]/route");
const { retryPendingStackSessionRevocations, stackServerSessionRevoker, STACK_SESSION_REVOCATION_POLICY } =
  await import("../services/vms/stackSessionRevocations");
const { databaseStackSessionRevocationStore } = await import("../services/vms/stackSessionRevocationStore");
const { clearNativeAuthCacheForTests } = await import("../services/vms/auth");

const originalFetch = globalThis.fetch;
let stackAnswers: number[] = [];

function stubStack(): void {
  globalThis.fetch = Object.assign(mock(async () => { throw new Error("Owned revocation must not contact an upstream provider"); }), { preconnect: Reflect.get(originalFetch, "preconnect") }) as typeof fetch;
}

function revokeRequest(): Request {
  return new Request(`https://cmux.test/api/vm/access-grants/${GRANT_ID}`, {
    method: "DELETE",
    headers: { authorization: "Bearer access-1" },
  });
}

beforeEach(() => {
  clearNativeAuthCacheForTests();
  rows.clear();
  ownedSessionIds.clear();
  for (const id of SESSIONS) ownedSessionIds.add(id);
  sessionDeletes.length = 0;
  stackAnswers = [];
  workflowCalls.length = 0;
  stubStack();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("access-grant session revocation", () => {
  test("an owned database failure answers pending, and a cron retry after backoff revokes and deletes the rows", async () => {
    stackAnswers = [429, 429];
    const response = await DELETE(revokeRequest(), { params: Promise.resolve({ id: GRANT_ID }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true, sessionRevocation: "pending" });
    // The grant revocation asked for the sessions to be queued with it.
    expect(workflowCalls).toHaveLength(1);
    expect([...rows.values()].map((row) => [row.stackSessionId, row.attempts])).toEqual([
      [SESSIONS[0], 1],
      [SESSIONS[1], 1],
    ]);

    const store = databaseStackSessionRevocationStore();
    const revoke = stackServerSessionRevoker();
    // Not due yet: the backoff holds the retry.
    expect(await retryPendingStackSessionRevocations({ store, revoke })).toEqual({ attempted: 0, revoked: 0, pending: 0 });
    const later = () => new Date(Date.now() + 2 * 60_000);
    expect(await retryPendingStackSessionRevocations({ store, revoke, now: later })).toEqual({ attempted: 2, revoked: 2, pending: 0 });
    expect(rows.size).toBe(0);
  });

  test("an accepted revocation answers revoked and leaves nothing for the cron", async () => {
    const response = await DELETE(revokeRequest(), { params: Promise.resolve({ id: GRANT_ID }) });
    expect(await response.json()).toEqual({ revoked: true, sessionRevocation: "revoked" });
    expect(rows.size).toBe(0);
  });

  test("revocation deletes only the identified owned session without any provider HTTP call", async () => {
    await stackServerSessionRevoker()(SESSIONS[0]!);
    expect(sessionDeletes).toEqual([SESSIONS[0]!]);
    expect(ownedSessionIds.has(SESSIONS[0]!)).toBe(false);
    expect(ownedSessionIds.has(SESSIONS[1]!)).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test("an absent owned session is idempotent and a database failure remains retryable", async () => {
    await expect(stackServerSessionRevoker()(SESSIONS[0]!)).resolves.toBeUndefined();
    await expect(stackServerSessionRevoker()(SESSIONS[0]!)).resolves.toBeUndefined();
    stackAnswers = [503];
    await expect(stackServerSessionRevoker()(SESSIONS[1]!)).rejects.toThrow("Owned database unavailable");
    await expect(stackServerSessionRevoker()("invalid-session-id")).rejects.toThrow("Owned session id is invalid");
  });

  test("a row that reaches the attempt cap gives up and is reported exactly once", async () => {
    rows.set("00000000-0000-4000-8000-00000000000d", {
      stackSessionId: "00000000-0000-4000-8000-00000000000d",
      userId: USER_ID,
      attempts: STACK_SESSION_REVOCATION_POLICY.maxAttempts - 1,
      nextAttemptAt: new Date(0),
      claimedUntil: null,
      createdAt: new Date(),
      gaveUpAt: null,
    });
    stackAnswers = [429, 429];
    const reported: unknown[] = [];
    const store = databaseStackSessionRevocationStore();
    const revoke = stackServerSessionRevoker();
    const far = () => new Date(Date.now() + 48 * 60 * 60_000);
    await retryPendingStackSessionRevocations({ store, revoke, now: far, onGiveUp: (row) => reported.push(row) });
    await retryPendingStackSessionRevocations({ store, revoke, now: far, onGiveUp: (row) => reported.push(row) });
    expect(reported).toEqual([{
      stackSessionId: "00000000-0000-4000-8000-00000000000d",
      userId: USER_ID,
      attempts: STACK_SESSION_REVOCATION_POLICY.maxAttempts,
      error: "Error",
    }]);
    expect(rows.get("00000000-0000-4000-8000-00000000000d")!.gaveUpAt).not.toBeNull();
  });
});

describe("vm-reconcile cron", () => {
  test("retries due session revocations", async () => {
    rows.set("00000000-0000-4000-8000-00000000000c", {
      stackSessionId: "00000000-0000-4000-8000-00000000000c",
      userId: USER_ID,
      attempts: 3,
      nextAttemptAt: new Date(0),
      claimedUntil: null,
      createdAt: new Date(),
      gaveUpAt: null,
    });
    const { GET } = await import("../app/api/cron/vm-reconcile/route");
    const response = await GET(new Request("https://cmux.test/api/cron/vm-reconcile", {
      headers: { authorization: "Bearer cron-secret" },
    }));
    const body = await response.json() as { stackSessionRevocations?: unknown };
    expect(body.stackSessionRevocations).toEqual({ attempted: 1, revoked: 1, pending: 0 });
    expect(rows.has("00000000-0000-4000-8000-00000000000c")).toBe(false);
  });
});
