import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { cloudDb } from "../db/client";
import { betterAuthUser, betterAuthSession, betterAuthOrganization, betterAuthMember } from "../db/betterAuthSchema";
import { POST } from "../app/api/internal/auth-authority/route";
const dbTest = process.env.CMUX_DB_TEST === "1" ? test : test.skip;
/** The service authority boundary independently checks live session and role state behind a Worker ticket. */
dbTest("authority refuses session, member, and role revocation while keeping requests scoped", async () => {
  const db = cloudDb(); const actor = randomUUID(); const org = randomUUID(); const sid = randomUUID(); const now = new Date();
  const previous = process.env.CMUX_AUTH_SERVICE_KEY;
  process.env.CMUX_AUTH_SERVICE_KEY = "owned-authority-database-test-key-20261014";
  const request = (patch: Record<string, unknown> = {}, key = process.env.CMUX_AUTH_SERVICE_KEY!) => new Request("https://cmux.w3dev.app/api/internal/auth-authority", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ actorUserId: actor, sessionId: sid, organizationId: org, userId: actor, action: "manage", ...patch }) });
  try {
    await db.insert(betterAuthUser).values({ id: actor, name: "Authority test", email: `${actor}@example.test`, emailVerified: true, createdAt: now, updatedAt: now });
    await db.insert(betterAuthOrganization).values({ id: org, name: "Authority test organization", slug: org, createdAt: now });
    await db.insert(betterAuthMember).values({ id: randomUUID(), organizationId: org, userId: actor, role: "owner", createdAt: now });
    await db.insert(betterAuthSession).values({ id: sid, token: randomUUID(), userId: actor, expiresAt: new Date(Date.now() + 60000), createdAt: now, updatedAt: now });
    const authorized = await POST(request()); expect(authorized.status).toBe(200); expect(await authorized.json()).toEqual({ allowed: true });
    const badKey = await POST(request({}, "wrong-service-key")); expect(badKey.status).toBe(401); expect(badKey.headers.get("cache-control")).toBe("no-store");
    expect(await (await POST(request({ sessionId: randomUUID() }))).json()).toEqual({ allowed: false });
    expect(await (await POST(request({ organizationId: randomUUID() }))).json()).toEqual({ allowed: false });
    await db.update(betterAuthMember).set({ role: "member" }).where(eq(betterAuthMember.organizationId, org));
    expect(await (await POST(request())).json()).toEqual({ allowed: false });
    expect(await (await POST(request({ action: "member" }))).json()).toEqual({ allowed: true });
    await db.delete(betterAuthMember).where(eq(betterAuthMember.organizationId, org));
    expect(await (await POST(request({ action: "member" }))).json()).toEqual({ allowed: false });
    await db.insert(betterAuthMember).values({ id: randomUUID(), organizationId: org, userId: actor, role: "owner", createdAt: now });
    await db.delete(betterAuthSession).where(eq(betterAuthSession.id, sid));
    const revoked = await POST(request()); expect(await revoked.json()).toEqual({ allowed: false }); expect(revoked.headers.get("cache-control")).toBe("no-store");
  } finally {
    await db.delete(betterAuthOrganization).where(eq(betterAuthOrganization.id, org)); await db.delete(betterAuthUser).where(eq(betterAuthUser.id, actor));
    if (previous === undefined) delete process.env.CMUX_AUTH_SERVICE_KEY; else process.env.CMUX_AUTH_SERVICE_KEY = previous;
  }
});
