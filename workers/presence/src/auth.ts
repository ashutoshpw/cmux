// Verify OAuth bearer credentials against the configured owned Better Auth authority.
// Current session and organization state are checked on every request. Only
// rejected credentials are cached, scoped to their authority origin.

export interface AuthEnv {
  CMUX_AUTH_ORIGIN?: string;
  /** Deprecated deployment inputs are never sent to a provider. */
  STACK_API_URL?: string;
  STACK_PROJECT_ID?: string;
  STACK_PUBLISHABLE_CLIENT_KEY?: string;
}

export interface AuthedUser {
  id: string;
  selectedTeamId: string | null;
  teamIds: readonly string[];
  /** Profile fields resolved from the verified owned user record. */
  displayName?: string | null;
  profileImageURL?: string | null;
}

/** Max cache age. A revoked-but-unexpired token stays usable for at most this
 * long on read/announce routes; routes that change durable state verify with
 * `fresh: true` and do not use a cached success. */
export const AUTH_CACHE_TTL_MS = 60_000;
const AUTH_CACHE_MAX_ENTRIES = 1024;
/** Negative cache window for a token Stack rejected. Bounds the amplification
 * where an unauthenticated caller forces one Stack subrequest per request by
 * sending an opaque (non-JWT, so no client-side expiry short-circuit) token;
 * short enough that a token which legitimately becomes valid is not stranded
 * for long. */
export const AUTH_NEGATIVE_CACHE_TTL_MS = 10_000;

interface CacheEntry {
  /** null marks a verified-failure (negative) entry. */
  user: AuthedUser | null;
  expiresAt: number;
}

// Isolate-global; resets whenever the isolate is recycled, which only costs an
// extra Stack round trip.
const authCache = new Map<string, CacheEntry>();

/** Cache deadline for a verified token: short TTL, never past the token's own
 * expiry. Pure for tests. */
export function cacheDeadline(
  nowMs: number,
  tokenExpMs: number | null,
  ttlMs: number = AUTH_CACHE_TTL_MS,
): number {
  const ttlDeadline = nowMs + ttlMs;
  if (tokenExpMs === null) return ttlDeadline;
  return Math.min(ttlDeadline, tokenExpMs);
}

/** Best-effort `exp` (epoch ms) from a JWT payload without verifying the
 * signature; verification is the Stack API call itself. Returns null for
 * opaque or malformed tokens. Pure for tests. */
export function tokenExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export type TeamResolution =
  | { ok: true; teamId: string }
  | { ok: false; error: "team_not_found" };

/** Resolve the team this request operates on, mirroring the web route exactly:
 * a requested team must be one the caller belongs to (their own user id counts
 * as the solo-account team); otherwise default to the selected team, then a
 * sole listed team, then the user id. Pure for tests. */
export function resolveTeamId(
  requested: string | null,
  user: AuthedUser,
): TeamResolution {
  if (requested) {
    const isMember = user.teamIds.includes(requested) || requested === user.id;
    if (!isMember) return { ok: false, error: "team_not_found" };
    return { ok: true, teamId: requested };
  }
  const soleTeam = user.teamIds.length === 1 ? user.teamIds[0] : null;
  return { ok: true, teamId: user.selectedTeamId ?? soleTeam ?? user.id };
}

/** Requested team from `X-Cmux-Team-Id` (or legacy billing header) or the
 * `teamId`-family query params, copied from
 * `web/services/vms/routeHelpers.ts#requestedVmTeamIdFromRequest`. */
export function requestedTeamIdFromRequest(request: Request): string | null {
  const fromHeader =
    normalized(request.headers.get("x-cmux-team-id")) ??
    normalized(request.headers.get("x-cmux-billing-team-id"));
  if (fromHeader) return fromHeader;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  return (
    normalized(url.searchParams.get("teamId")) ??
    normalized(url.searchParams.get("team_id")) ??
    normalized(url.searchParams.get("billingTeamId")) ??
    normalized(url.searchParams.get("billing_team_id"))
  );
}

function normalized(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** The bearer access token from the Authorization header, or null. Exported
 * so the subscribe route can bound stream lifetime to the token's expiry. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return null;
  return normalized(header.slice("bearer ".length));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function ownedAuthOrigin(env: AuthEnv): string {
  const value = env.CMUX_AUTH_ORIGIN;
  if (!value) throw new Error("Owned authentication origin is required");
  const url = new URL(value);
  if (url.origin !== value || !["https://cmux.w3dev.app", "https://staging.cmux.w3dev.app"].includes(url.origin)) throw new Error("Owned authentication origin is required");
  return url.origin;
}
async function fetchStackUser(env: AuthEnv, accessToken: string): Promise<AuthedUser | null> {
  const response = await fetch(`${ownedAuthOrigin(env)}/api/native-auth/session`, {
    headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5000), redirect: "error",
  });
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error("Owned authentication service is unavailable");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("user" in body) || !("organizations" in body)) throw new Error("Invalid authentication response");
  const user = body.user;
  if (!user || typeof user !== "object" || !("id" in user) || typeof user.id !== "string" || !Array.isArray(body.organizations)) throw new Error("Invalid authentication response");
  const teamIds = body.organizations.map((organization: unknown) => {
    if (!organization || typeof organization !== "object" || !("id" in organization) || typeof organization.id !== "string") throw new Error("Invalid organization response");
    return organization.id;
  });
  const selected = "activeOrganizationId" in body && typeof body.activeOrganizationId === "string" && teamIds.includes(body.activeOrganizationId) ? body.activeOrganizationId : null;
  return { id: user.id, selectedTeamId: selected, teamIds, displayName: "name" in user && typeof user.name === "string" ? user.name : null, profileImageURL: "image" in user && typeof user.image === "string" ? user.image : null };
}

/** Verify the caller. Returns the resolved user or null when unauthenticated
 * or when Stack auth is not configured (fail closed, like
 * `isStackConfigured()` on the web side). */
export async function verifyRequest(
  request: Request,
  env: AuthEnv,
  options: { readonly fresh?: boolean } = {},
): Promise<AuthedUser | null> {
  const token = bearerToken(request);
  if (!token) return null;

  const now = Date.now();
  const expMs = tokenExpiryMs(token);
  if (expMs !== null && expMs <= now) return null;

  const cacheKey = await sha256Hex(`${ownedAuthOrigin(env)}:${token}`);
  const cached = authCache.get(cacheKey);
  // A live entry serves either a verified user or a verified failure (null),
  // so a rejected token does not re-hit Stack on every request.
  // `fresh` (durable mutations: device revocation, control-socket setup)
  // never trusts a cached success, so a revoked bearer fails at once; a
  // cached rejection still answers without another Stack call.
  // Authorization uses current membership and revocation state every time.
  if (cached && cached.expiresAt > now && cached.user === null) return null;
  authCache.delete(cacheKey);

  const user = await fetchStackUser(env, token);

  if (authCache.size >= AUTH_CACHE_MAX_ENTRIES) {
    // Drop the oldest insertion; Map preserves insertion order.
    const oldest = authCache.keys().next().value;
    if (oldest !== undefined) authCache.delete(oldest);
  }
  if (!user) {
    // Negative cache: never past the token's own expiry (an expired-token
    // hash should fall through to the cheap expiry short-circuit next time).
    const negativeDeadline =
      expMs === null ? now + AUTH_NEGATIVE_CACHE_TTL_MS
        : Math.min(now + AUTH_NEGATIVE_CACHE_TTL_MS, expMs);
    authCache.set(cacheKey, { user: null, expiresAt: negativeDeadline });
    return null;
  }
  authCache.set(cacheKey, { user, expiresAt: cacheDeadline(now, expMs) });
  return user;
}
