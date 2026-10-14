import { Effect, Data } from "effect";
import { and, eq, gt, sql } from "drizzle-orm";
import { isAPIError } from "better-auth/api";
import { errors as joseErrors } from "jose";
import { cloudDb } from "../../db/client";
import { betterAuthMember, betterAuthOrganization, betterAuthSession, betterAuthUser,
  betterAuthOAuthAccessToken, betterAuthOAuthRefreshToken } from "../../db/betterAuthSchema";
import { getBetterAuth, type BetterAuthServer } from "./betterAuthServer";
import { applicationOrigin } from "../deployment/origin";
import { hasBlockingAccountDeletionIdentity } from "../account/deletionLock";

export type BetterAuthOrganizationPrincipal = {
  id: string; name: string; slug: string; role: string; image: string | null;
  clientReadOnlyMetadata: Record<string, unknown>;
};
export type BetterAuthPrincipal = {
  userId: string; displayName: string; email: string; emailVerified: boolean;
  image: string | null; createdAt: Date; isAnonymous: boolean;
  clientReadOnlyMetadata: Record<string, unknown>;
  sessionId: string; sessionCreatedAt: Date; activeOrganizationId: string | null;
  organizations: BetterAuthOrganizationPrincipal[];
  authentication: "cookie" | "oauth"; scopes: string[];
};

export class BetterAuthUnavailable extends Data.TaggedError("BetterAuthUnavailable")<{
  readonly message: string;
}> {}
export class BetterAuthForbidden extends Data.TaggedError("BetterAuthForbidden")<{
  readonly message: string;
}> {}

function metadata(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function getBetterAuthSession(headers: Headers, auth: BetterAuthServer = getBetterAuth()) {
  const cookieHeaders = new Headers(headers);
  cookieHeaders.delete("authorization");
  return auth.api.getSession({ headers: cookieHeaders, query: { disableCookieCache: true } });
}

type RequestIdentity = { userId: string; sessionId: string; scopes: string[] };
export type BetterAuthPrincipalOptions = { readonly allowDeletingAccount?: boolean };

async function readRequestIdentity(headers: Headers, auth: BetterAuthServer): Promise<RequestIdentity | null> {
  if (!headers.has("authorization")) {
    const session = await getBetterAuthSession(headers, auth);
    return session ? { userId: session.user.id, sessionId: session.session.id, scopes: [] } : null;
  }
  try { return await auth.api.cmuxVerifyToken({ headers }); }
  catch (error) {
    if (isAPIError(error) && [400, 401, 403].includes(error.statusCode)) return null;
    if (error instanceof joseErrors.JOSEError) return null;
    throw error;
  }
}

async function currentOrganizations(db: ReturnType<typeof cloudDb>, user: typeof betterAuthUser.$inferSelect): Promise<BetterAuthOrganizationPrincipal[]> {
  if (!user.emailVerified || user.isAnonymous) return [];
  const memberships = await db.select({ organization: betterAuthOrganization, role: betterAuthMember.role })
    .from(betterAuthMember).innerJoin(betterAuthOrganization, eq(betterAuthMember.organizationId, betterAuthOrganization.id))
    .where(eq(betterAuthMember.userId, user.id));
  return memberships.map(({ organization, role }) => ({ id: organization.id, name: organization.name,
    slug: organization.slug, role, image: organization.logo, clientReadOnlyMetadata: metadata(organization.clientReadOnlyMetadata) }));
}

async function loadCurrentPrincipal(identity: RequestIdentity, authentication: "cookie" | "oauth", options: BetterAuthPrincipalOptions): Promise<BetterAuthPrincipal | null> {
  const db = cloudDb();
  const [row] = await db.select({ user: betterAuthUser, session: betterAuthSession })
    .from(betterAuthSession).innerJoin(betterAuthUser, eq(betterAuthSession.userId, betterAuthUser.id))
    .where(and(eq(betterAuthSession.id, identity.sessionId), eq(betterAuthUser.id, identity.userId), gt(betterAuthSession.expiresAt, new Date()))).limit(1);
  if (!row) return null;
  const { user, session } = row;
  if (!options.allowDeletingAccount && await hasBlockingAccountDeletionIdentity(db, [user.id])) return null;
  if (authentication === "oauth" && (!user.emailVerified || user.isAnonymous)) return null;
  const organizations = await currentOrganizations(db, user);
  const selected = session.activeOrganizationId;
  return { userId: user.id, displayName: user.name, email: user.email, emailVerified: user.emailVerified,
    image: user.image, createdAt: user.createdAt, isAnonymous: user.isAnonymous === true,
    clientReadOnlyMetadata: metadata(user.clientReadOnlyMetadata), sessionId: session.id, sessionCreatedAt: session.createdAt,
    activeOrganizationId: selected && organizations.some(org => org.id === selected) ? selected : null,
    organizations, authentication, scopes: identity.scopes };
}

/** Resolve current session, current user and current memberships on every protected request. */
export function resolveBetterAuthPrincipalEffect(headers: Headers, options: BetterAuthPrincipalOptions = {}) {
  return Effect.tryPromise({
    try: async (): Promise<BetterAuthPrincipal | null> => {
      const identity = await readRequestIdentity(headers, getBetterAuth());
      return identity ? loadCurrentPrincipal(identity, headers.has("authorization") ? "oauth" : "cookie", options) : null;
    },
    catch: () => new BetterAuthUnavailable({ message: "Authentication could not be verified against current state" }),
  });
}

export async function resolveBetterAuthPrincipal(headers: Headers, options: BetterAuthPrincipalOptions = {}): Promise<BetterAuthPrincipal | null> {
  return Effect.runPromise(resolveBetterAuthPrincipalEffect(headers, options));
}

/** Browser forwarding receives a short-lived OAuth token, never the cookie session token. */
export async function getBetterAuthBrowserAccessToken(headers: Headers): Promise<string | null> {
  if (headers.get("origin") && headers.get("origin") !== applicationOrigin()) throw new BetterAuthForbidden({ message: "Cross-origin authentication is forbidden" });
  if (headers.get("sec-fetch-site") === "cross-site") throw new BetterAuthForbidden({ message: "Cross-site authentication is forbidden" });
  const principal = await resolveBetterAuthPrincipal(headers);
  if (!principal || principal.authentication !== "cookie" || !principal.emailVerified || principal.isAnonymous) return null;
  const result = await getBetterAuth().api.cmuxBrowserToken({ headers });
  return result.access_token;
}

export function updateBetterAuthOrganization(headers: Headers, organizationId: string | null) {
  return Effect.gen(function* () {
    const principal = yield* resolveBetterAuthPrincipalEffect(headers);
    if (!principal || !principal.emailVerified || principal.isAnonymous) return yield* new BetterAuthForbidden({ message: "Authentication is required" });
    yield* Effect.tryPromise({
      try: () => cloudDb().transaction(async tx => {
        if (organizationId) {
          const [membership] = await tx.select({ id: betterAuthMember.id }).from(betterAuthMember)
            .where(and(eq(betterAuthMember.userId, principal.userId), eq(betterAuthMember.organizationId, organizationId))).for("share").limit(1);
          if (!membership) throw new BetterAuthForbidden({ message: "Organization membership is required" });
        }
        const updated = await tx.update(betterAuthSession).set({ activeOrganizationId: organizationId, updatedAt: new Date() })
          .where(and(eq(betterAuthSession.id, principal.sessionId), eq(betterAuthSession.userId, principal.userId), gt(betterAuthSession.expiresAt, new Date()))).returning({ id: betterAuthSession.id });
        if (!updated.length) throw new BetterAuthForbidden({ message: "The session is no longer active" });
        await tx.update(betterAuthUser).set({ selectedTeamId: organizationId, updatedAt: new Date() }).where(eq(betterAuthUser.id, principal.userId));
      }),
      catch: error => error instanceof BetterAuthForbidden ? error : new BetterAuthUnavailable({ message: "Organization could not be selected" }),
    });
  });
}

/** Revoke every grant associated with this session before removing the session itself. */
export function revokeBetterAuthSession(headers: Headers) {
  return Effect.gen(function* () {
    const principal = yield* resolveBetterAuthPrincipalEffect(headers);
    if (!principal) return;
    yield* Effect.tryPromise({
      try: () => cloudDb().transaction(async tx => {
        await tx.execute(sql`select 1 from ${betterAuthSession} where ${betterAuthSession.id} = ${principal.sessionId} for update`);
        await tx.delete(betterAuthOAuthAccessToken).where(eq(betterAuthOAuthAccessToken.sessionId, principal.sessionId));
        await tx.delete(betterAuthOAuthRefreshToken).where(eq(betterAuthOAuthRefreshToken.sessionId, principal.sessionId));
        await tx.delete(betterAuthSession).where(and(eq(betterAuthSession.id, principal.sessionId), eq(betterAuthSession.userId, principal.userId)));
      }),
      catch: () => new BetterAuthUnavailable({ message: "The session could not be revoked" }),
    });
  });
}
