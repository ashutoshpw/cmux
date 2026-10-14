import { resolveBetterAuthPrincipal, type BetterAuthPrincipal } from "../auth/betterAuthPrincipal";
import { getStackServerApp, isStackConfigured } from "../../app/lib/stack";
import type { StackAccessTokenIdentity } from "../auth/stackAccessToken";
import { withStackAuthSpan } from "../auth/stackTelemetry";
import {
  billingPlanIdFromMetadata,
  billingSeatsFromMetadata,
  resolveBillingTeam,
} from "../billing/teamResolution";
import {
  isDevelopmentProAccessEnabled,
  PRO_PLAN_ID,
} from "../billing/pro";

export type AuthedUser = {
  id: string;
  isAnonymous?: boolean;
  displayName: string | null;
  primaryEmail: string | null;
  billingCustomerType: "team" | "user";
  billingTeamId: string;
  selectedTeamId: string | null;
  teams: readonly AuthedTeam[];
  teamIds: readonly string[];
  userBillingPlanId: string | null;
  billingPlanId: string | null;
  /** Paid seats on the resolved billing team; null for user billing or unknown. */
  billingSeats: number | null;
};

export type AuthedTeam = {
  id: string;
  displayName: string | null;
  billingPlanId: string | null;
  billingSeats: number | null;
};

export class SubrouterAuthorizationConfigurationError extends Error {
  override readonly name = "SubrouterAuthorizationConfigurationError";
}

export class SubrouterAuthorizationTimeoutError extends Error {
  override readonly name = "SubrouterAuthorizationTimeoutError";
}

export class SubrouterAuthorizationUnavailableError extends Error {
  override readonly name = "SubrouterAuthorizationUnavailableError";
}

/**
 * Stack Auth rejected (or is presumed to be rejecting) verification with a
 * project-wide throttle. The message keeps the "rate limited" wording that
 * `authProviderErrorResponse` and `relayAuthenticationError` detect.
 */
export class StackAuthRateLimitedError extends Error {
  override readonly name = "StackAuthRateLimitedError";
}

export type NativeStackTokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
};

export function parseNativeStackTokens(
  request: Request,
): NativeStackTokens | null {
  const authorization = request.headers.get("authorization");
  const refreshToken = request.headers.get("x-stack-refresh-token")?.trim();
  if (
    !authorization?.toLowerCase().startsWith("bearer ")
  ) {
    return null;
  }
  const accessToken = authorization.slice("bearer ".length).trim();
  return accessToken ? { accessToken, refreshToken: refreshToken ?? "" } : null;
}

type VerifyRequestOptions = {
  readonly requestedTeamId?: string | null;
  readonly allowCookie?: boolean;
  readonly allowDeletingAccount?: boolean;
  readonly listAllTeams?: boolean;
  readonly subrouterAuthorizationSignal?: AbortSignal;
  /** Compatibility flag: owned auth always resolves complete current organizations. */
  readonly forceCompleteTeamList?: boolean;
  /** Publication management must recheck every membership and ignore stale team selection. */
  readonly requireFreshTeamMembership?: boolean;
};

const DEFAULT_SUBROUTER_STACK_AUTH_TIMEOUT_MS = 10_000;
const MAX_SUBROUTER_STACK_AUTH_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_STACK_AUTHORIZATION_CALLS = 8;
const MAX_QUEUED_STACK_AUTHORIZATION_CALLS = 32;

/** Compatibility hooks: owned auth always checks live session and membership state. */
export function clearNativeAuthCacheForTests(): void {}
export function invalidateNativeAuthCacheForTokens(tokens: NativeStackTokens): void { void tokens; }
export function invalidateNativeAuthCacheForUser(userId: string): void { void userId; }
export function clearStackThrottleCircuitForTests(): void {}

let activeStackAuthorizationCalls = 0;
let timedOutStackAuthorizationCalls = 0;
const stackAuthorizationWaiters: Array<{
  readonly signal: AbortSignal;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  readonly abort: () => void;
}> = [];

export async function withSubrouterAuthorizationDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = subrouterStackAuthorizationTimeoutMs();
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new SubrouterAuthorizationTimeoutError(
        "Stack authorization deadline exceeded",
      ));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      operation(controller.signal),
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

/**
 * Run an owned auth call under a caller's authorization deadline. The call shares
 * the deadline-gated concurrency slots and `cmux.stack_auth.*` span with
 * verification, and rejects with `SubrouterAuthorizationTimeoutError` once the
 * signal aborts. A call that has not started when the signal aborts never
 * starts.
 */
export function deadlineGatedStackCall<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  operationName: string,
): Promise<T> {
  return stackAuthorizationCall(operation, signal, operationName);
}

export async function verifySubrouterRequest(
  request: Request,
  signal: AbortSignal,
  options: Omit<VerifyRequestOptions, "subrouterAuthorizationSignal"> = {},
): Promise<AuthedUser | null> {
  return verifyRequest(request, {
    ...options,
    subrouterAuthorizationSignal: signal,
  });
}

/**
 * Verify a browser session without resolving its team or billing state.
 * Dashboard layouts use this narrow check before they render any private UI.
 * The shared authorization slot bounds the owned session lookup with the caller's deadline.
 */
export async function verifyBrowserSessionRequest(
  request: Request,
  signal: AbortSignal,
) {
  if (!isStackConfigured()) return null;
  const user = await stackAuthorizationCall(
    () => getStackServerApp().getUser({
      or: "return-null",
      tokenStore: request as unknown as {
        headers: { get(name: string): string | null };
      },
    }),
    signal,
    "get_user",
  );
  return user && !user.isAnonymous ? user : null;
}

export function isSubrouterAuthorizationError(
  error: unknown,
): error is
  | SubrouterAuthorizationConfigurationError
  | SubrouterAuthorizationTimeoutError
  | SubrouterAuthorizationUnavailableError {
  return error instanceof SubrouterAuthorizationConfigurationError ||
    error instanceof SubrouterAuthorizationTimeoutError ||
    error instanceof SubrouterAuthorizationUnavailableError;
}

function subrouterStackAuthorizationTimeoutMs(
  raw = process.env.SUBROUTER_STACK_AUTH_TIMEOUT_MS,
): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_SUBROUTER_STACK_AUTH_TIMEOUT_MS;
  }
  if (!/^[1-9][0-9]*$/.test(raw.trim())) {
    throw new SubrouterAuthorizationConfigurationError(
      "SUBROUTER_STACK_AUTH_TIMEOUT_MS must be a positive integer",
    );
  }
  const timeout = Number(raw);
  if (!Number.isSafeInteger(timeout) || timeout > MAX_SUBROUTER_STACK_AUTH_TIMEOUT_MS) {
    throw new SubrouterAuthorizationConfigurationError(
      `SUBROUTER_STACK_AUTH_TIMEOUT_MS must not exceed ${MAX_SUBROUTER_STACK_AUTH_TIMEOUT_MS}`,
    );
  }
  return timeout;
}

async function stackAuthorizationCall<T>(
  operation: () => Promise<T>,
  signal: AbortSignal | undefined,
  operationName = "request",
): Promise<T> {
  const timedOperation = () => withStackAuthSpan(operationName, operation, {
    "cmux.auth.deadline_gated": signal !== undefined,
  });
  if (!signal) return timedOperation();
  const release = await acquireStackAuthorizationSlot(signal);
  let pending: Promise<T>;
  try {
    pending = Promise.resolve().then(timedOperation);
  } catch (error) {
    release();
    throw new SubrouterAuthorizationUnavailableError(
      error instanceof Error ? error.message : "Stack authorization failed",
      { cause: error },
    );
  }
  void pending.then(release, release);
  try {
    return await waitForStackAuthorization(pending, signal);
  } catch (error) {
    if (error instanceof SubrouterAuthorizationTimeoutError) {
      markTimedOutStackAuthorizationCall(pending);
      throw error;
    }
    throw new SubrouterAuthorizationUnavailableError(
      error instanceof Error ? error.message : "Stack authorization failed",
      { cause: error },
    );
  }
}

function acquireStackAuthorizationSlot(
  signal: AbortSignal,
): Promise<() => void> {
  if (signal.aborted) {
    return Promise.reject(new SubrouterAuthorizationTimeoutError(
      "Stack authorization deadline exceeded",
    ));
  }
  // Stack's SDK does not expose a transport AbortSignal. If every underlying
  // call has outlived its caller deadline, fail new work immediately until one
  // settles instead of growing a queue behind an unrecoverable transport.
  if (
    timedOutStackAuthorizationCalls >=
      MAX_CONCURRENT_STACK_AUTHORIZATION_CALLS
  ) {
    // Local overload behind a slow Stack: transient, like the timeouts behind it.
    return Promise.reject(Object.assign(new SubrouterAuthorizationUnavailableError(
      "Stack authorization circuit is open",
    ), { transient: true }));
  }
  if (
    activeStackAuthorizationCalls <
      MAX_CONCURRENT_STACK_AUTHORIZATION_CALLS
  ) {
    activeStackAuthorizationCalls += 1;
    return Promise.resolve(releaseStackAuthorizationSlot);
  }
  if (
    stackAuthorizationWaiters.length >=
      MAX_QUEUED_STACK_AUTHORIZATION_CALLS
  ) {
    // Local overload behind a slow Stack: transient, like the timeouts behind it.
    return Promise.reject(Object.assign(new SubrouterAuthorizationUnavailableError(
      "Stack authorization queue is full",
    ), { transient: true }));
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      signal,
      resolve,
      reject,
      abort: () => {
        const index = stackAuthorizationWaiters.indexOf(waiter);
        if (index >= 0) stackAuthorizationWaiters.splice(index, 1);
        reject(new SubrouterAuthorizationTimeoutError(
          "Stack authorization deadline exceeded",
        ));
      },
    };
    stackAuthorizationWaiters.push(waiter);
    signal.addEventListener("abort", waiter.abort, { once: true });
  });
}

function markTimedOutStackAuthorizationCall(pending: Promise<unknown>): void {
  timedOutStackAuthorizationCalls += 1;
  void pending.then(
    retireTimedOutStackAuthorizationCall,
    retireTimedOutStackAuthorizationCall,
  );
}

function retireTimedOutStackAuthorizationCall(): void {
  timedOutStackAuthorizationCalls = Math.max(
    0,
    timedOutStackAuthorizationCalls - 1,
  );
}

function releaseStackAuthorizationSlot(): void {
  while (stackAuthorizationWaiters.length > 0) {
    const waiter = stackAuthorizationWaiters.shift()!;
    waiter.signal.removeEventListener("abort", waiter.abort);
    if (waiter.signal.aborted) continue;
    waiter.resolve(releaseStackAuthorizationSlot);
    return;
  }
  activeStackAuthorizationCalls = Math.max(
    0,
    activeStackAuthorizationCalls - 1,
  );
}

function waitForStackAuthorization<T>(
  pending: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new SubrouterAuthorizationTimeoutError(
      "Stack authorization deadline exceeded",
    ));
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(new SubrouterAuthorizationTimeoutError(
        "Stack authorization deadline exceeded",
      ));
    };
    signal.addEventListener("abort", abort, { once: true });
    void pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/**
 * Verify the caller's Stack Auth session. Accepts either a cookie (browser path) or a
 * `Authorization: Bearer <access>` + `X-Stack-Refresh-Token: <refresh>` pair from the
 * native macOS client.
 *
 * Returns the resolved user or null if unauthenticated.
 */
export async function verifyRequest(request: Request, options: VerifyRequestOptions = {}): Promise<AuthedUser | null> {
  if (!isStackConfigured()) return null;
  const hasNativeHeader = request.headers.has("authorization") || request.headers.has("x-stack-refresh-token");
  if (hasNativeHeader && !parseNativeStackTokens(request)) return null;
  if (!hasNativeHeader && options.allowCookie === false) return null;
  const principal = await stackAuthorizationCall(() => resolveBetterAuthPrincipal(request.headers, { allowDeletingAccount: options.allowDeletingAccount }), options.subrouterAuthorizationSignal, "get_user");
  if (!principal || principal.isAnonymous || !principal.emailVerified) return null;
  return authedUserFromPrincipal(principal);
}

async function authedUserFromPrincipal(principal: BetterAuthPrincipal): Promise<AuthedUser> {
  const teams = principal.organizations.map((organization) => ({ id: organization.id, displayName: organization.name, clientReadOnlyMetadata: organization.clientReadOnlyMetadata }));
  const selectedTeam = teams.find((team) => team.id === principal.activeOrganizationId) ?? null;
  const billingTeam = await resolveBillingTeam({ selectedTeam, listTeams: async () => teams });
  const developmentPro = !principal.isAnonymous && isDevelopmentProAccessEnabled();
  const userBillingPlanId = developmentPro ? PRO_PLAN_ID : billingPlanIdFromMetadata(principal.clientReadOnlyMetadata);
  const billingPlanId = developmentPro ? PRO_PLAN_ID : billingPlanIdFromMetadata(billingTeam?.clientReadOnlyMetadata) ?? userBillingPlanId;
  return { id: principal.userId, isAnonymous: principal.isAnonymous, displayName: principal.displayName, primaryEmail: principal.email,
    billingCustomerType: billingTeam ? "team" : "user", billingTeamId: billingTeam?.id ?? principal.userId, selectedTeamId: selectedTeam?.id ?? null,
    teams: teams.map((team) => ({ id: team.id, displayName: team.displayName, billingPlanId: developmentPro ? PRO_PLAN_ID : billingPlanIdFromMetadata(team.clientReadOnlyMetadata), billingSeats: billingSeatsFromMetadata(team.clientReadOnlyMetadata) })),
    teamIds: teams.map((team) => team.id), userBillingPlanId, billingPlanId, billingSeats: billingSeatsFromMetadata(billingTeam?.clientReadOnlyMetadata) };
}

/** Compatibility entrypoint; verifies current owned session and complete organization membership. */
export async function verifyRequestFromSnapshot(
  request: Request,
  options: {
    readonly requestedTeamId?: string | null;
    /** Deprecated compatibility inputs; never override owned authorization. */
    readonly maxSnapshotAgeMs?: number;
    /** Deprecated compatibility input; owned session authority is always used. */
    readonly verifyAccessToken?: (
      accessToken: string,
    ) => Promise<StackAccessTokenIdentity | null>;
    /** Deprecated compatibility input; tombstones are checked by owned auth. */
    readonly isAccountDeleted?: (userId: string) => Promise<boolean>;
  } = {},
): Promise<AuthedUser | null> {
  // Membership, account state and session revocation are always current.
  return verifyRequest(request, { requestedTeamId: options.requestedTeamId, allowCookie: false,
    requireFreshTeamMembership: true, forceCompleteTeamList: true });
}

/**
 * The caller's complete current organization membership, or null when the
 * owned session cannot be established. Never answered from a positive cache.
 *
 * Tunnel enrollment uses this to decide which team networks to keep: the
 * route's normal verification resolves only the selected team, and treating
 * that one team as the whole membership would detach every other team.
 */
export async function verifyCompleteTeamMembership(
  request: Request,
  expectedUserId: string,
): Promise<readonly string[] | null> {
  try {
    const user = await verifyRequest(request, {
      requireFreshTeamMembership: true,
      forceCompleteTeamList: true,
    });
    return user?.id === expectedUserId ? user.teamIds : null;
  } catch {
    return null;
  }
}

export type VerifiedIdentity = {
  readonly id: string;
  /** How the identity was established; surfaced for logs and tests. */
  readonly source: "access_token" | "stack";
};

type VerifyIdentityOptions = {
  readonly allowCookie?: boolean;
  /**
   * Skip the local token check and ask Stack, so a revoked session is refused
   * immediately. Use for sensitive, low-volume operations.
   */
  readonly requireStackSession?: boolean;
  /** High-volume native routes reject invalid tokens locally instead of asking Stack. */
  readonly allowStackFallback?: boolean;
  /** Deprecated compatibility input; owned session authority is always used. */
  readonly verifyAccessToken?: (
    accessToken: string,
  ) => Promise<StackAccessTokenIdentity | null>;
};

/** Resolve identity from the live owned session, including account revocation state. */
export async function verifyRequestIdentity(
  request: Request,
  options: VerifyIdentityOptions = {},
): Promise<VerifiedIdentity | null> {
  const user = await verifyRequest(request, { allowCookie: options.allowCookie,
    requireFreshTeamMembership: true, forceCompleteTeamList: true });
  return user ? { id: user.id, source: "stack" } : null;
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}
