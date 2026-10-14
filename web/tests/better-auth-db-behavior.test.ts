import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { base32 } from "@better-auth/utils/base32";
import { generateTOTP } from "@oslojs/otp";
import { getBetterAuth, closeBetterAuthForTests } from "../services/auth/betterAuthServer";
import { getBetterAuthBrowserAccessToken, resolveBetterAuthPrincipal } from "../services/auth/betterAuthPrincipal";
import { cloudDb, closeCloudDbForTests } from "../db/client";
import { AccountDeletionLastOrganizationAdminError, assertAccountDeletionOrganizationAdmins } from "../services/account/organizationDeletionGuard";
import { GET as getSession } from "../app/api/native-auth/session/route";
import { POST as setOrganization } from "../app/api/native-auth/organization/route";
import { POST as signOut } from "../app/api/native-auth/sign-out/route";
import { verifyRequest, verifyRequestFromSnapshot, verifyRequestIdentity } from "../services/vms/auth";
import { defaultTeamStackApp } from "../services/teams/stack";
import { getStackServerApp } from "../app/lib/stack";
import { createInvitationCodeClient } from "../services/teams/invitationCode";

const runDbTests = process.env.CMUX_DB_TEST === "1";
const dbTest = runDbTests ? test : test.skip;
const origin = "https://cmux.w3dev.app";
const resource = `${origin}/api`;
const callback = "cmux-w3dev://auth-callback";
const password = "test-authentication-password-2026";
const deliveredMail: Array<{ to: string; subject: string; text: string }> = [];
// Only the mail transport is replaced; link creation, storage and redemption use the actual provider.
mock.module("resend", () => ({ Resend: class {
  emails = { send: async (message: { to: string; subject: string; text: string }) => {
    deliveredMail.push(message);
    return { data: { id: "local-test-delivery" }, error: null };
  } };
} }));
let pool: Pool;
let userId: string;
let organizationId: string;
let cookie: string;

beforeAll(() => {
  if (!runDbTests) return;
  process.env.RESEND_API_KEY = "local-test-mail-transport";
  process.env.CMUX_AUTH_FROM_EMAIL = "auth@example.test";
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for Better Auth DB behavior tests");
  pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
});

beforeEach(async () => {
  if (!runDbTests) return;
  deliveredMail.length = 0;
  await pool.query("delete from auth_user");
  await pool.query("delete from auth_rate_limit");
  await pool.query("delete from account_deletion_tombstones");
  await pool.query("update auth_oauth_client set disabled=false");
  userId = randomUUID(); organizationId = randomUUID();
  await pool.query("insert into auth_user(id,name,email,email_verified,created_at,updated_at,client_read_only_metadata,server_metadata) values($1,'Test User','auth-test@example.test',true,now(),now(),$2,$3)", [userId, { cmuxReviewDemoContent: true }, { privateValue: "server-only" }]);
  await pool.query("insert into auth_account(id,account_id,provider_id,user_id,password,created_at,updated_at) values($1,$2::text,'credential',$2::uuid,$3,now(),now())", [randomUUID(), userId, await hashPassword(password)]);
  await pool.query("insert into auth_organization(id,name,slug,created_at) values($1,'Test Organization',$2,now())", [organizationId, organizationId]);
  await pool.query("insert into auth_member(id,organization_id,user_id,role,created_at) values($1,$2,$3,'owner',now())", [randomUUID(), organizationId, userId]);
  const response = await getBetterAuth().api.signInEmail({ body: { email: "auth-test@example.test", password }, asResponse: true });
  expect(response.status).toBe(200);
  cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
});

afterAll(async () => {
  if (!runDbTests) return;
  await closeBetterAuthForTests();
  await closeCloudDbForTests();
  await pool.end();
});

function bearer(token: string) { return new Headers({ authorization: `Bearer ${token}` }); }
function sessionRequest(token: string) { return new Request(`${origin}/api/native-auth/session`, { headers: bearer(token) }); }

async function authorize(overrides: Record<string, string> = {}) {
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({ client_id: "cmux-w3dev-macos", redirect_uri: callback,
    response_type: "code", scope: "openid profile email offline_access cmux:api", resource,
    state: randomBytes(16).toString("hex"), code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256", ...overrides });
  const response = await getBetterAuth().handler(new Request(`${origin}/api/auth/oauth2/authorize?${query}`, { headers: { cookie } }));
  return { response, verifier };
}

async function tokenRequest(body: Record<string, string>) {
  return getBetterAuth().handler(new Request(`${origin}/api/auth/oauth2/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body),
  }));
}

async function nativeTokens() {
  const { response, verifier } = await authorize();
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location")!);
  expect(`${location.protocol}//${location.host}${location.pathname}`).toBe(callback);
  const code = location.searchParams.get("code")!;
  expect(Boolean(code)).toBe(true);
  const tokens = await tokenRequest({ grant_type: "authorization_code", client_id: "cmux-w3dev-macos",
    redirect_uri: callback, code, code_verifier: verifier, resource });
  expect(tokens.status).toBe(200);
  return tokens.json() as Promise<{ access_token: string; refresh_token: string }>;
}

function responseCookie(response: Response) {
  return response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
}

function authPost(path: string, body: Record<string, unknown>, cookieValue = "") {
  return getBetterAuth().handler(new Request(`${origin}/api/auth${path}`, {
    method: "POST", headers: { origin, cookie: cookieValue, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function enableTotpAndSignOut() {
  const enabled = await authPost("/two-factor/enable", { password }, cookie);
  expect(enabled.status).toBe(200);
  const uri = new URL((await enabled.json()).totpURI);
  const secret = base32.decode(uri.searchParams.get("secret")!);
  const code = () => generateTOTP(secret, 30, 6);
  const verified = await authPost("/two-factor/verify-totp", { code: code() }, cookie);
  expect(verified.status).toBe(200);
  const signedOut = await authPost("/sign-out", {}, responseCookie(verified));
  expect(signedOut.status).toBe(200);
  cookie = "";
  return code;
}

async function secondOrganizationMember(role = "member") {
  const memberId = randomUUID();
  await pool.query("insert into auth_user(id,name,email,email_verified,created_at,updated_at) values($1,'Other Member',$2,true,now(),now())", [memberId, `${memberId}@example.test`]);
  await pool.query("insert into auth_member(id,organization_id,user_id,role,created_at) values($1,$2,$3,$4,now())", [randomUUID(), organizationId, memberId, role]);
  return memberId;
}

describe("owned Better Auth resource boundary", () => {
  dbTest("email OTP requires TOTP before exposing a resource session or continuing native OAuth", async () => {
    const code = await enableTotpAndSignOut();
    const pending = await authorize();
    const login = new URL(pending.response.headers.get("location")!, origin);
    expect(login.pathname).toBe("/handler/sign-in");
    const oauthQuery = login.search.slice(1);
    expect((await authPost("/email-otp/send-verification-otp", { email: "auth-test@example.test", type: "sign-in" })).status).toBe(200);
    const otp = deliveredMail.at(-1)!.text.match(/\b\d{6}\b/u)![0];
    const firstFactor = await authPost("/sign-in/email-otp", { email: "auth-test@example.test", otp, oauth_query: oauthQuery });
    const pendingCookie = responseCookie(firstFactor);
    expect((await getSession(new Request(`${origin}/api/native-auth/session`, { headers: { cookie: pendingCookie } }))).status).toBe(401);
    const challenge = await firstFactor.json();
    expect(challenge).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(challenge.token).toBeUndefined();
    expect(challenge.url).toBeUndefined();
    expect(Number((await pool.query("select count(*) as count from auth_session where user_id=$1", [userId])).rows[0].count)).toBe(0);
    expect((await authPost("/two-factor/verify-totp", { code: "0000000", oauth_query: oauthQuery }, pendingCookie)).status).toBeGreaterThanOrEqual(400);
    expect((await getSession(new Request(`${origin}/api/native-auth/session`, { headers: { cookie: pendingCookie } }))).status).toBe(401);
    const verified = await authPost("/two-factor/verify-totp", { code: code(), oauth_query: oauthQuery }, pendingCookie);
    expect(verified.status).toBe(200);
    cookie = responseCookie(verified);
    const destination = new URL((await verified.json()).url);
    expect(`${destination.protocol}//${destination.host}${destination.pathname}`).toBe(callback);
    const tokens = await tokenRequest({ grant_type: "authorization_code", client_id: "cmux-w3dev-macos", redirect_uri: callback,
      code: destination.searchParams.get("code")!, code_verifier: pending.verifier, resource });
    expect(tokens.status).toBe(200);
    expect((await getSession(sessionRequest((await tokens.json()).access_token))).status).toBe(200);
  });

  dbTest("magic-link redemption requires TOTP before exposing a session or native authorization code", async () => {
    const code = await enableTotpAndSignOut();
    expect((await authPost("/sign-in/magic-link", { email: "auth-test@example.test", callbackURL: "/handler/after-sign-in" })).status).toBe(200);
    const link = deliveredMail.at(-1)!.text.match(/https:\/\/cmux\.w3dev\.app\/api\/auth\/magic-link\/verify\?[^\s]+/u)![0];
    const firstFactor = await getBetterAuth().handler(new Request(link));
    cookie = responseCookie(firstFactor);
    expect((await getSession(new Request(`${origin}/api/native-auth/session`, { headers: { cookie } }))).status).toBe(401);
    const redirect = new URL(firstFactor.headers.get("location")!, origin);
    expect(redirect.pathname).toBe("/handler/sign-in");
    expect(redirect.searchParams.get("mfa")).toBe("required");
    expect(redirect.searchParams.get("after_auth_return_to")).toBe("/handler/after-sign-in");
    const pending = await authorize();
    expect(new URL(pending.response.headers.get("location")!, origin).searchParams.has("code")).toBe(false);
    expect(Number((await pool.query("select count(*) as count from auth_session where user_id=$1", [userId])).rows[0].count)).toBe(0);
    expect((await authPost("/two-factor/verify-totp", { code: "0000000" }, cookie)).status).toBeGreaterThanOrEqual(400);
    expect((await getSession(new Request(`${origin}/api/native-auth/session`, { headers: { cookie } }))).status).toBe(401);
    const verified = await authPost("/two-factor/verify-totp", { code: code() }, cookie);
    expect(verified.status).toBe(200);
    cookie = responseCookie(verified);
    expect((await getSession(new Request(`${origin}/api/native-auth/session`, { headers: { cookie } }))).status).toBe(200);
    expect((await getSession(sessionRequest((await nativeTokens()).access_token))).status).toBe(200);
  });

  dbTest("public organization leave cannot bypass the owned team's revocation and administrator path", async () => {
    await secondOrganizationMember("owner");
    await pool.query("update auth_member set role='member' where organization_id=$1 and user_id=$2", [organizationId, userId]);
    const blocked = await authPost("/organization/leave", { organizationId }, cookie);
    expect(blocked.status).toBe(404);
    expect(Number((await pool.query("select count(*) as count from auth_member where organization_id=$1 and user_id=$2", [organizationId, userId])).rows[0].count)).toBe(1);
  });

  dbTest("deletion cannot remove a shared organization's final current administrator", async () => {
    await secondOrganizationMember();
    await expect(cloudDb().transaction(tx => assertAccountDeletionOrganizationAdmins(tx, userId))).rejects.toThrow(AccountDeletionLastOrganizationAdminError);
  });

  dbTest("a standard invitation cannot admit a member after its sole owner's deletion starts", async () => {
    const ownerId = await secondOrganizationMember("owner");
    await pool.query("delete from auth_member where organization_id=$1 and user_id=$2", [organizationId, userId]);
    const invitationId = randomUUID();
    await pool.query("insert into auth_invitation(id,organization_id,email,role,status,expires_at,created_at,inviter_id) values($1,$2,'auth-test@example.test','member','pending',now()+interval '1 day',now(),$3)", [invitationId, organizationId, ownerId]);
    expect(await getBetterAuth().api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
    const token = await getBetterAuthBrowserAccessToken(new Headers({ cookie }));
    expect(token).not.toBeNull();
    await cloudDb().transaction(async tx => {
      await assertAccountDeletionOrganizationAdmins(tx, ownerId);
      await tx.execute(sql`insert into account_deletion_tombstones(user_id_hash,user_id,status) values(${createHash("sha256").update(ownerId).digest("hex")},${ownerId},'pending')`);
    });
    const result = await createInvitationCodeClient().accept(invitationId, token!);
    const status = (await pool.query("select status from auth_invitation where id=$1", [invitationId])).rows[0].status;
    await (await getStackServerApp().getUser(ownerId))!.delete();
    expect(result).toEqual({ ok: false, failure: "invalid" });
    expect(status).toBe("pending");
    expect(Number((await pool.query("select count(*) from auth_member where organization_id=$1", [organizationId])).rows[0].count)).toBe(0);
  });

  dbTest("concurrent administrator deletions preserve one current administrator", async () => {
    const secondId = await secondOrganizationMember("admin");
    const begin = (id: string) => cloudDb().transaction(async tx => {
      await assertAccountDeletionOrganizationAdmins(tx, id);
      await tx.execute(sql`insert into account_deletion_tombstones(user_id_hash,user_id,status) values(${createHash("sha256").update(id).digest("hex")},${id},'pending')`);
    });
    const results = await Promise.allSettled([begin(userId), begin(secondId)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });

  dbTest("deletion permits personal organizations and current replacements while excluding deleting administrators", async () => {
    const check = (id: string) => cloudDb().transaction(tx => assertAccountDeletionOrganizationAdmins(tx, id));
    await expect(check(userId)).resolves.toBeUndefined();
    const replacement = await secondOrganizationMember("admin");
    await expect(check(userId)).resolves.toBeUndefined();
    await pool.query("insert into account_deletion_tombstones(user_id_hash,user_id,status) values($1,$2,'pending')", [createHash("sha256").update(replacement).digest("hex"), replacement]);
    await expect(check(userId)).rejects.toThrow(AccountDeletionLastOrganizationAdminError);
    await pool.query("delete from account_deletion_tombstones");
    await pool.query("update auth_member set role='member' where organization_id=$1 and user_id=$2", [organizationId, userId]);
    await expect(check(userId)).resolves.toBeUndefined();
  });

  dbTest("an actual PKCE exchange returns the current native principal and only public metadata", async () => {
    const { access_token } = await nativeTokens();
    const response = await getSession(sessionRequest(access_token));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.user).toMatchObject({ id: userId, email: "auth-test@example.test", emailVerified: true });
    expect(result.user.serverMetadata).toBeUndefined();
    expect(result.organizations).toEqual([{ id: organizationId, name: "Test Organization", slug: organizationId, role: "owner" }]);
    expect(result.activeOrganizationId).toBe(organizationId);
  });

  dbTest("unregistered callback destinations and missing S256 challenges cannot receive authorization codes", async () => {
    const invalid: Record<string, string>[] = [{ redirect_uri: "cmux-w3dev://evil" }, { redirect_uri: "cmux://auth-callback" }, { code_challenge: "", code_challenge_method: "" }];
    for (const overrides of invalid) {
      const { response } = await authorize(overrides);
      const destination = response.headers.get("location");
      if (destination) {
        const url = new URL(destination, origin);
        expect(url.searchParams.has("code")).toBe(false);
        expect(url.origin === origin || destination.startsWith(`${callback}?error=`)).toBe(true);
      } else expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });

  dbTest("a stolen authorization code without its verifier cannot be exchanged", async () => {
    const { response } = await authorize();
    const code = new URL(response.headers.get("location")!).searchParams.get("code")!;
    const rejected = await tokenRequest({ grant_type: "authorization_code", client_id: "cmux-w3dev-macos", redirect_uri: callback,
      code, code_verifier: randomBytes(32).toString("base64url"), resource });
    expect(rejected.status).toBe(401);
    const result = await rejected.json();
    expect(result.error).toBeTruthy();
    expect(result.access_token).toBeUndefined();
  });

  dbTest("membership removal is reflected immediately by a previously issued token", async () => {
    const { access_token } = await nativeTokens();
    await pool.query("delete from auth_member where user_id=$1", [userId]);
    const current = await getSession(sessionRequest(access_token));
    expect(current.status).toBe(200);
    const principal = await current.json();
    expect(principal.organizations).toEqual([]);
    expect(principal.activeOrganizationId).toBeNull();
    const selection = await setOrganization(new Request(`${origin}/api/native-auth/organization`, {
      method: "POST", headers: bearer(access_token), body: JSON.stringify({ organizationId }),
    }));
    expect(selection.status).toBe(403);
  });

  dbTest("sign-out revokes the session and its refresh family while the JWT is unexpired", async () => {
    const tokens = await nativeTokens();
    const response = await signOut(new Request(`${origin}/api/native-auth/sign-out`, { method: "POST", headers: bearer(tokens.access_token) }));
    expect(response.status).toBe(200);
    expect((await getSession(sessionRequest(tokens.access_token))).status).toBe(401);
    const refreshed = await tokenRequest({ grant_type: "refresh_token", client_id: "cmux-w3dev-macos", refresh_token: tokens.refresh_token, resource });
    expect(refreshed.status).toBeGreaterThanOrEqual(400);
    expect((await refreshed.json()).access_token).toBeUndefined();
    expect(await resolveBetterAuthPrincipal(new Headers({ cookie }))).toBeNull();
  });

  dbTest("disabling a client disconnects its already-issued JWT", async () => {
    const { access_token } = await nativeTokens();
    await pool.query("update auth_oauth_client set disabled=true where client_id='cmux-w3dev-macos'");
    expect((await getSession(sessionRequest(access_token))).status).toBe(401);
  });

  dbTest("unlinking a client from its resource disconnects an already-issued JWT", async () => {
    const { access_token } = await nativeTokens();
    await pool.query("delete from auth_oauth_client_resource where client_id='cmux-w3dev-macos' and resource_id=$1", [resource]);
    try { expect((await getSession(sessionRequest(access_token))).status).toBe(401); }
    finally { await pool.query("insert into auth_oauth_client_resource(client_id,resource_id,created_at) values('cmux-w3dev-macos',$1,now()) on conflict do nothing", [resource]); }
  });

  dbTest("invalid signatures, issuer, audience and expiry fail before resource access", async () => {
    const tokens = await nativeTokens();
    const principal = await resolveBetterAuthPrincipal(bearer(tokens.access_token));
    const payload = { sub: userId, sid: principal!.sessionId, azp: "cmux-w3dev-macos", scope: "openid profile email cmux:api" };
    const wrongIssuer = await getBetterAuth().api.signJWT({ body: { payload, overrideOptions: { jwt: { issuer: "https://example.test/api/auth" } } } });
    const wrongAudience = await getBetterAuth().api.signJWT({ body: { payload, overrideOptions: { jwt: { audience: "https://example.test/api" } } } });
    const expired = await getBetterAuth().api.signJWT({ body: { payload, overrideOptions: { jwt: { expirationTime: new Date(Date.now() - 60_000) } } } });
    const parts = tokens.access_token.split(".");
    parts[2] = randomBytes(64).toString("base64url");
    for (const token of [parts.join("."), wrongIssuer.token, wrongAudience.token, expired.token]) {
      expect((await getSession(sessionRequest(token))).status).toBe(401);
    }
  });

  dbTest("current anonymous or unverified state cannot use a previously issued API token", async () => {
    const { access_token } = await nativeTokens();
    await pool.query("update auth_user set email_verified=false where id=$1", [userId]);
    expect((await getSession(sessionRequest(access_token))).status).toBe(401);
    expect(await verifyRequest(new Request(`${origin}/api/vms`, { headers: { cookie } }))).toBeNull();
    await pool.query("update auth_user set email_verified=true,is_anonymous=true where id=$1", [userId]);
    expect((await getSession(sessionRequest(access_token))).status).toBe(401);
  });

  dbTest("deletion tombstones block shared authentication while allowing an explicit server recovery read", async () => {
    const { access_token } = await nativeTokens();
    await pool.query("insert into account_deletion_tombstones(user_id_hash,user_id,status) values($1,$2,'pending')", [createHash("sha256").update(userId).digest("hex"), userId]);
    expect((await getSession(sessionRequest(access_token))).status).toBe(401);
    expect(await resolveBetterAuthPrincipal(new Headers({ cookie }))).toBeNull();
    expect((await resolveBetterAuthPrincipal(bearer(access_token), { allowDeletingAccount: true }))?.userId).toBe(userId);
  });

  dbTest("browser forwarding issues a resource token and rejects cross-origin requests", async () => {
    const token = await getBetterAuthBrowserAccessToken(new Headers({ cookie, origin }));
    expect(Boolean(token)).toBe(true);
    expect((await getSession(sessionRequest(token!))).status).toBe(200);
    await expect(getBetterAuthBrowserAccessToken(new Headers({ cookie, origin: "https://example.test" }))).rejects.toThrow("Cross-origin");
    expect(await getBetterAuthBrowserAccessToken(new Headers())).toBeNull();
    const publicEndpoint = await getBetterAuth().handler(new Request(`${origin}/api/auth/cmux/browser-token`, { headers: { cookie, origin } }));
    expect(publicEndpoint.status).toBe(404);
  });

  dbTest("anonymous purchase sessions cannot create organizations or use the native API", async () => {
    const response = await getBetterAuth().api.signInAnonymous({ asResponse: true });
    expect(response.status).toBe(200);
    const anonymousCookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    expect((await getSession(new Request(`${origin}/api/native-auth/session`, { headers: { cookie: anonymousCookie } }))).status).toBe(401);
    expect(await verifyRequest(new Request(`${origin}/api/vms`, { headers: { cookie: anonymousCookie } }))).toBeNull();
    const create = await getBetterAuth().handler(new Request(`${origin}/api/auth/organization/create`, {
      method: "POST", headers: { cookie: anonymousCookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Unauthorized Organization", slug: "anonymous-not-allowed" }),
    }));
    expect(create.status).toBe(404);
  });

  dbTest("organization HTTP mutations are disabled while trusted server APIs remain usable", async () => {
    const body = { name: "Server Organization", slug: randomUUID() };
    const blocked = await getBetterAuth().handler(new Request(`${origin}/api/auth/organization/create`, {
      method: "POST", headers: { cookie, origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    expect(blocked.status).toBe(404);
    const created = await getBetterAuth().api.createOrganization({ headers: new Headers({ cookie }), body });
    expect(created?.name).toBe("Server Organization");
  });

  dbTest("VM identity and membership entrypoints share current revocation checks without native refresh headers", async () => {
    const { access_token } = await nativeTokens();
    expect((await verifyRequest(sessionRequest(access_token)))?.id).toBe(userId);
    expect((await verifyRequestFromSnapshot(sessionRequest(access_token)))?.teamIds).toEqual([organizationId]);
    expect((await verifyRequestIdentity(sessionRequest(access_token)))?.id).toBe(userId);
    const source = await resolveBetterAuthPrincipal(bearer(access_token));
    await pool.query("delete from auth_session where id=$1", [source!.sessionId]);
    expect(await verifyRequest(sessionRequest(access_token))).toBeNull();
    expect(await verifyRequestFromSnapshot(sessionRequest(access_token))).toBeNull();
    expect(await verifyRequestIdentity(sessionRequest(access_token))).toBeNull();
  });

  dbTest("contact channels reflect the owned primary email verification state", async () => {
    const contacts = defaultTeamStackApp();
    expect(await contacts.listUserContactChannels(userId)).toMatchObject([{ type: "email", value: "auth-test@example.test", isVerified: true }]);
    await pool.query("update auth_user set email_verified=false where id=$1", [userId]);
    expect(await contacts.listUserContactChannels(userId)).toMatchObject([{ type: "email", value: "auth-test@example.test", isVerified: false }]);
    expect(await contacts.listUserContactChannels(randomUUID())).toBeNull();
  });

  dbTest("refresh rotates the public client's token pair and safely replays a duplicate request", async () => {
    const original = await nativeTokens();
    const input = { grant_type: "refresh_token", client_id: "cmux-w3dev-macos", refresh_token: original.refresh_token, resource };
    const response = await tokenRequest(input);
    expect(response.status).toBe(200);
    const renewed = await response.json();
    expect(renewed.refresh_token).not.toBe(original.refresh_token);
    expect((await getSession(sessionRequest(renewed.access_token))).status).toBe(200);
    const duplicate = await tokenRequest(input);
    expect(duplicate.status).toBe(200);
    expect((await duplicate.json()).refresh_token).toBe(renewed.refresh_token);
  });

  dbTest("a delivered magic link creates one verified personal session and cannot be replayed", async () => {
    const email = `new-${randomUUID()}@example.test`;
    const requested = await getBetterAuth().handler(new Request(`${origin}/api/auth/sign-in/magic-link`, {
      method: "POST", headers: { origin, "Content-Type": "application/json", "Accept-Language": "ja" },
      body: JSON.stringify({ email, name: "Fresh User", callbackURL: "/handler/after-sign-in" }),
    }));
    expect(requested.status).toBe(200);
    const mail = deliveredMail.find(message => message.to === email);
    expect(Boolean(mail)).toBe(true);
    const link = new URL(mail!.text.match(/https:\/\/cmux\.w3dev\.app\/api\/auth\/magic-link\/verify\?[^\s]+/u)![0]);
    const token = link.searchParams.get("token")!;
    const stored = await pool.query("select identifier from auth_verification where value like $1", [`%${email}%`]);
    expect(stored.rows.length).toBe(1);
    expect(stored.rows[0].identifier === token).toBe(false);
    const redeemed = await getBetterAuth().handler(new Request(link));
    expect(redeemed.status).toBe(302);
    const newCookie = redeemed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const current = await getSession(new Request(`${origin}/api/native-auth/session`, { headers: { cookie: newCookie } }));
    expect(current.status).toBe(200);
    const identity = await current.json();
    expect(identity.user.emailVerified).toBe(true);
    expect(identity.organizations).toHaveLength(1);
    expect(identity.organizations[0].role).toBe("owner");
    expect(identity.activeOrganizationId).toBe(identity.organizations[0].id);
    const replayed = await getBetterAuth().handler(new Request(link));
    expect(replayed.headers.get("set-cookie")).toBeNull();
    const sessions = await pool.query("select count(*) as count from auth_session where user_id=$1", [identity.user.id]);
    expect(Number(sessions.rows[0].count)).toBe(1);
  });

  dbTest("purchase recovery's facade sends an actual link and refuses foreign callback destinations", async () => {
    const app = getStackServerApp();
    await expect(app.sendMagicLinkEmail("auth-test@example.test", { callbackUrl: "https://example.test/steal" })).rejects.toThrow();
    expect(deliveredMail).toHaveLength(0);
    const result = await app.sendMagicLinkEmail("auth-test@example.test", { callbackUrl: "/handler/after-sign-in" });
    expect(result.status).toBe("ok");
    expect(deliveredMail).toHaveLength(1);
    expect(deliveredMail[0]!.text).toContain("/api/auth/magic-link/verify?token=");
  });
});
