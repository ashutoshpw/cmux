import { Effect } from "effect";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq, gt, ilike, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { cloudDb } from "../../db/client";
import {
  betterAuthUser as users,
  betterAuthSession as sessions,
  betterAuthOrganization as organizations,
  betterAuthMember as members,
  betterAuthInvitation as invitations,
  betterAuthAccount as accounts,
  betterAuthApiKey as apiKeys,
} from "../../db/betterAuthSchema";
import { getBetterAuth } from "../../services/auth/betterAuthServer";
import {
  resolveBetterAuthPrincipal,
  getBetterAuthBrowserAccessToken,
  revokeBetterAuthSession,
} from "../../services/auth/betterAuthPrincipal";
import { withFreshAccountMetadataUser } from "../../services/account/metadataMutation";
import { canonicalizeEmailForMatching } from "../../services/billing/emailMatching";
import { applicationOrigin } from "../../services/deployment/origin";
import { assertOrganizationMembershipAdmission } from "../../services/teams/organizationAdministration";
import { withTeamAdminLock } from "../../services/teams/repository";

type UserRow = typeof users.$inferSelect;
type OrganizationRow = typeof organizations.$inferSelect;
type KeyRow = typeof apiKeys.$inferSelect;
type Metadata = Record<string, unknown>;
export type AuthJson = {
  accessToken: string | null;
  refreshToken: string | null;
};
export type AuthTokenStore =
  | { readonly headers: { get(name: string): string | null } }
  | {
      readonly accessToken?: string | null;
      readonly refreshToken?: string | null;
    };
type ListOptions = {
  cursor?: string;
  limit?: number;
  query?: string;
  includeAnonymous?: boolean;
  includeRestricted?: boolean;
  orderBy?: string;
  desc?: boolean;
};
export type AuthPage<T> = T[] & { nextCursor: string | null };
export type UserUpdate = {
  displayName?: string | null;
  profileImageUrl?: string | null;
  primaryEmail?: string | null;
  primaryEmailVerified?: boolean;
  clientMetadata?: unknown;
  clientReadOnlyMetadata?: unknown;
  serverMetadata?: unknown;
  selectedTeamId?: string | null;
  isAnonymous?: boolean;
};

function metadata(value: unknown): Metadata {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}
async function authHeaders(store?: AuthTokenStore): Promise<Headers> {
  if (!store) return new Headers(await headers());
  const result = new Headers();
  if ("headers" in store) {
    for (const name of [
      "cookie",
      "authorization",
      "origin",
      "user-agent",
      "x-forwarded-for",
    ]) {
      const value = store.headers.get(name);
      if (value !== null) result.set(name, value);
    }
  } else if (store.accessToken)
    result.set("authorization", `Bearer ${store.accessToken}`);
  return result;
}
function page<T>(
  items: T[],
  limit: number,
  id: (item: T) => string,
): AuthPage<T> {
  const selected = items.slice(0, limit);
  return Object.assign(selected, {
    nextCursor:
      items.length > limit ? id(selected[selected.length - 1]!) : null,
  });
}
const ADMIN_PERMISSIONS = [
  "team_admin",
  "$update_team",
  "$delete_team",
  "$invite_members",
  "$read_members",
  "$remove_members",
  "$manage_api_keys",
];
function permissions(role: string) {
  return role.split(",").some((role) => role === "owner" || role === "admin")
    ? ADMIN_PERMISSIONS
    : ["$read_members"];
}
async function invalidate(userId: string) {
  const [{ invalidateNativeAuthCacheForUser }, { deleteIdentitySnapshot }] =
    await Promise.all([
      import("../../services/vms/auth"),
      import("../../services/auth/identitySnapshot"),
    ]);
  invalidateNativeAuthCacheForUser(userId);
  await deleteIdentitySnapshot(userId, undefined, { throwOnError: true });
}

export class OwnedApiKey {
  constructor(private readonly row: KeyRow) {}
  get id() {
    return this.row.id;
  }
  get description() {
    return this.row.description;
  }
  get createdAt() {
    return this.row.createdAt;
  }
  get expiresAt() {
    return this.row.expiresAt;
  }
  get manuallyRevokedAt() {
    return this.row.revokedAt;
  }
  get value() {
    return { lastFour: this.row.lastFour };
  }
  whyInvalid(): "manually-revoked" | "expired" | null {
    if (this.row.revokedAt) return "manually-revoked";
    return this.row.expiresAt && this.row.expiresAt.getTime() <= Date.now()
      ? "expired"
      : null;
  }
  async revoke() {
    await cloudDb()
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeys.id, this.id));
  }
}
async function listKeys(
  owner: { userId: string } | { organizationId: string },
) {
  return (
    await cloudDb()
      .select()
      .from(apiKeys)
      .where(
        "userId" in owner
          ? eq(apiKeys.userId, owner.userId)
          : eq(apiKeys.organizationId, owner.organizationId),
      )
  ).map((row) => new OwnedApiKey(row));
}
type KeyCreateInput = { description: string; expiresAt?: Date | null; expiresInMillis?: number | null; permissions?: readonly string[] };
type KeyFirstView = { id: string; description: string; createdAt: Date; expiresAt: Date | null; value: { reveal(): string; lastFour: string } };
export class OwnedTeam {
  constructor(private readonly row: OrganizationRow) {}
  get id() {
    return this.row.id;
  }
  get displayName() {
    return this.row.name;
  }
  get profileImageUrl() {
    return this.row.logo;
  }
  get clientReadOnlyMetadata() {
    return metadata(this.row.clientReadOnlyMetadata);
  }
  get serverMetadata() {
    return metadata(this.row.serverMetadata);
  }
  get createdAt() {
    return this.row.createdAt;
  }
  async listUsers() {
    const rows = await cloudDb()
      .select({ user: users, member: members })
      .from(members)
      .innerJoin(users, eq(members.userId, users.id))
      .where(eq(members.organizationId, this.id));
    return Promise.all(
      rows.map(async ({ user, member }) =>
        Object.assign(await ownedUser(user), {
          teamProfile: {
            displayName: member.displayName,
            profileImageUrl: member.image,
          },
        }),
      ),
    );
  }
  async addUser(userId: string) {
    await withTeamAdminLock(this.id, async tx => {
      await assertOrganizationMembershipAdmission(tx, this.id, userId);
      await tx.insert(members).values({
        id: randomUUID(),
        organizationId: this.id,
        userId,
        role: "member",
        createdAt: new Date(),
      }).onConflictDoNothing();
      await invalidate(userId);
    });
  }
  async removeUser(userId: string) {
    const { revokeTeamMemberAccess } =
      await import("../../services/vms/teamMemberRevocation");
    await revokeTeamMemberAccess({ teamId: this.id, userId });
    await cloudDb()
      .delete(members)
      .where(
        and(eq(members.organizationId, this.id), eq(members.userId, userId)),
      );
    await cloudDb()
      .update(sessions)
      .set({ activeOrganizationId: null })
      .where(
        and(
          eq(sessions.userId, userId),
          eq(sessions.activeOrganizationId, this.id),
        ),
      );
    await cloudDb()
      .update(users)
      .set({ selectedTeamId: null })
      .where(and(eq(users.id, userId), eq(users.selectedTeamId, this.id)));
    await invalidate(userId);
  }
  async inviteUser(input: { email: string; callbackUrl?: string }) {
    await getBetterAuth().api.createInvitation({
      headers: await headers(),
      body: { email: input.email, organizationId: this.id, role: "member" },
    });
  }
  async listInvitations() {
    return (
      await cloudDb()
        .select()
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, this.id),
            eq(invitations.status, "pending"),
          ),
        )
    ).map((row) => ({
      id: row.id,
      recipientEmail: row.email,
      expiresAt: row.expiresAt,
      revoke: async () => {
        await cloudDb()
          .update(invitations)
          .set({ status: "canceled" })
          .where(eq(invitations.id, row.id));
      },
    }));
  }
  async update(input: {
    displayName?: string;
    profileImageUrl?: string | null;
    clientReadOnlyMetadata?: unknown;
    serverMetadata?: unknown;
  }) {
    await cloudDb()
      .update(organizations)
      .set({
        ...(input.displayName === undefined ? {} : { name: input.displayName }),
        ...(input.profileImageUrl === undefined
          ? {}
          : { logo: input.profileImageUrl }),
        ...(input.clientReadOnlyMetadata === undefined
          ? {}
          : { clientReadOnlyMetadata: metadata(input.clientReadOnlyMetadata) }),
        ...(input.serverMetadata === undefined
          ? {}
          : { serverMetadata: metadata(input.serverMetadata) }),
      })
      .where(eq(organizations.id, this.id));
    await Promise.all(
      (await this.listUsers()).map((user) => invalidate(user.id)),
    );
  }
  async delete() {
    const people = await this.listUsers();
    const { revokeTeamAccess } =
      await import("../../services/vms/teamMemberRevocation");
    await revokeTeamAccess({ teamId: this.id });
    await cloudDb().delete(organizations).where(eq(organizations.id, this.id));
    await Promise.all(people.map((user) => invalidate(user.id)));
  }
  listApiKeys() {
    return listKeys({ organizationId: this.id });
  }
  createApiKey(
    _input: KeyCreateInput,
  ): Promise<KeyFirstView> {
    void _input;
    return Promise.reject(new Error("API key authentication is not enabled"));
  }
}
export class OwnedUser {
  constructor(
    private readonly row: UserRow,
    readonly selectedTeam: OwnedTeam | null,
    private readonly sessionId: string | null = null,
    private readonly request?: Headers,
  ) {}
  get id() {
    return this.row.id;
  }
  get displayName() {
    return this.row.name;
  }
  get primaryEmail() {
    return this.row.email;
  }
  get primaryEmailVerified() {
    return this.row.emailVerified;
  }
  get profileImageUrl() {
    return this.row.image;
  }
  get signedUpAt() {
    return this.row.createdAt;
  }
  get isAnonymous() {
    return this.row.isAnonymous === true;
  }
  get isRestricted() {
    return !this.isAnonymous && !this.primaryEmailVerified;
  }
  get clientMetadata() {
    return metadata(this.row.clientMetadata);
  }
  get clientReadOnlyMetadata() {
    return metadata(this.row.clientReadOnlyMetadata);
  }
  get serverMetadata() {
    return metadata(this.row.serverMetadata);
  }
  async listTeams(options: ListOptions = {}): Promise<AuthPage<OwnedTeam>> {
    const limit = Math.min(options.limit ?? 100, 1000);
    const conditions = [eq(members.userId, this.id)];
    if (options.cursor) conditions.push(gt(organizations.id, options.cursor));
    if (options.query)
      conditions.push(
        or(
          eq(organizations.id, options.query),
          ilike(organizations.name, `%${options.query}%`),
        )!,
      );
    const rows = await cloudDb()
      .select({ organization: organizations })
      .from(members)
      .innerJoin(organizations, eq(members.organizationId, organizations.id))
      .where(and(...conditions))
      .orderBy(asc(organizations.id))
      .limit(limit + 1);
    return page(
      rows.map(({ organization }) => new OwnedTeam(organization)),
      limit,
      (team) => team.id,
    );
  }
  async getTeam(id: string) {
    const [row] = await cloudDb()
      .select({ organization: organizations })
      .from(members)
      .innerJoin(organizations, eq(members.organizationId, organizations.id))
      .where(and(eq(members.userId, this.id), eq(organizations.id, id)))
      .limit(1);
    return row ? new OwnedTeam(row.organization) : null;
  }
  async hasPermission(scope: { readonly id: string }, permission: string) {
    const [row] = await cloudDb()
      .select()
      .from(members)
      .where(
        and(eq(members.userId, this.id), eq(members.organizationId, scope.id)),
      )
      .limit(1);
    return row ? permissions(row.role).includes(permission) : false;
  }
  async grantPermission(scope: { readonly id: string }, permission: string) {
    if (permission !== "team_admin")
      throw new Error(`Unsupported permission: ${permission}`);
    const [member] = await cloudDb()
      .select()
      .from(members)
      .where(
        and(eq(members.userId, this.id), eq(members.organizationId, scope.id)),
      )
      .limit(1);
    if (member?.role !== "owner")
      await cloudDb()
        .update(members)
        .set({ role: "admin" })
        .where(
          and(
            eq(members.userId, this.id),
            eq(members.organizationId, scope.id),
          ),
        );
    await invalidate(this.id);
  }
  async revokePermission(scope: { readonly id: string }, permission: string) {
    if (permission !== "team_admin")
      throw new Error(`Unsupported permission: ${permission}`);
    await cloudDb()
      .update(members)
      .set({ role: "member" })
      .where(
        and(eq(members.userId, this.id), eq(members.organizationId, scope.id)),
      );
    await invalidate(this.id);
  }
  async update(input: UserUpdate) {
    if (input.selectedTeamId && !(await this.getTeam(input.selectedTeamId)))
      throw new Error("Organization membership required");
    await cloudDb()
      .update(users)
      .set({
        updatedAt: new Date(),
        ...(input.displayName === undefined
          ? {}
          : { name: input.displayName ?? "" }),
        ...(input.profileImageUrl === undefined
          ? {}
          : { image: input.profileImageUrl }),
        ...(input.primaryEmail === undefined
          ? {}
          : { email: input.primaryEmail ?? "" }),
        ...(input.primaryEmailVerified === undefined
          ? {}
          : { emailVerified: input.primaryEmailVerified }),
        ...(input.isAnonymous === undefined
          ? {}
          : { isAnonymous: input.isAnonymous }),
        ...(input.selectedTeamId === undefined
          ? {}
          : { selectedTeamId: input.selectedTeamId }),
        ...(input.clientMetadata === undefined
          ? {}
          : { clientMetadata: metadata(input.clientMetadata) }),
        ...(input.clientReadOnlyMetadata === undefined
          ? {}
          : { clientReadOnlyMetadata: metadata(input.clientReadOnlyMetadata) }),
        ...(input.serverMetadata === undefined
          ? {}
          : { serverMetadata: metadata(input.serverMetadata) }),
      })
      .where(eq(users.id, this.id));
    if (input.selectedTeamId !== undefined && this.sessionId)
      await cloudDb()
        .update(sessions)
        .set({ activeOrganizationId: input.selectedTeamId })
        .where(eq(sessions.id, this.sessionId));
    await invalidate(this.id);
  }
  setPrimaryEmail(email: string | null, options: { verified?: boolean } = {}) {
    if (!email) throw new Error("A primary email is required");
    return this.update({
      primaryEmail: email,
      primaryEmailVerified: options.verified,
    });
  }
  createTeam(input: { displayName: string }) {
    return getStackServerApp().createTeam({ ...input, creatorUserId: this.id });
  }
  async listContactChannels() {
    return [
      {
        id: this.id,
        type: "email" as const,
        value: this.primaryEmail,
        isVerified: this.primaryEmailVerified,
        isPrimary: true,
        usedForAuth: !this.isAnonymous,
        sendVerificationEmail: async (input: { callbackUrl?: string } = {}) => {
          await getBetterAuth().api.sendVerificationEmail({
            body: {
              email: this.primaryEmail,
              callbackURL: ownedAuthCallback(input.callbackUrl),
            },
          });
        },
      },
    ];
  }
  async getActiveSessions() {
    return (
      await cloudDb()
        .select()
        .from(sessions)
        .where(
          and(eq(sessions.userId, this.id), gt(sessions.expiresAt, new Date())),
        )
    ).map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastUsedAt: session.updatedAt,
      isImpersonation: false,
      isCurrentSession: session.id === this.sessionId,
      geoInfo: { ip: session.ipAddress, cityName: null, countryCode: null },
    }));
  }
  async listOAuthProviders() {
    return (
      await cloudDb()
        .select()
        .from(accounts)
        .where(eq(accounts.userId, this.id))
    )
      .filter((account) => account.providerId !== "credential")
      .map((account) => ({
        id: account.providerId,
        type: account.providerId,
        email: this.primaryEmail,
        allowSignIn: true,
        allowConnectedAccounts: true,
      }));
  }
  listApiKeys() {
    return listKeys({ userId: this.id });
  }
  createApiKey(
    _input: KeyCreateInput,
  ): Promise<KeyFirstView> {
    void _input;
    return Promise.reject(new Error("API key authentication is not enabled"));
  }
  async listNotificationCategories() {
    const preferences = metadata(this.clientMetadata.notifications);
    return [
      {
        id: "account",
        name: "Account notifications",
        enabled: true,
        canDisable: false,
      },
      {
        id: "product",
        name: "Product updates",
        enabled: preferences.product !== false,
        canDisable: true,
      },
    ];
  }
  async delete() {
    await cloudDb().delete(users).where(eq(users.id, this.id));
    await invalidate(this.id);
  }
  get currentSession() {
    return {
      getTokens: async () =>
        getStackServerApp().getAuthJson({
          tokenStore: { headers: this.request ?? new Headers() },
        }),
    };
  }
}
async function ownedUser(
  row: UserRow,
  sessionId: string | null = null,
  request?: Headers,
): Promise<OwnedUser> {
  let selected: OwnedTeam | null = null;
  if (row.selectedTeamId) {
    const [joined] = await cloudDb()
      .select({ organization: organizations })
      .from(members)
      .innerJoin(organizations, eq(organizations.id, members.organizationId))
      .where(
        and(
          eq(members.userId, row.id),
          eq(members.organizationId, row.selectedTeamId),
        ),
      )
      .limit(1);
    if (joined) selected = new OwnedTeam(joined.organization);
  }
  return new OwnedUser(row, selected, sessionId, request);
}
export class OwnedAuthServerApp {
  async getUser(
    input?:
      | string
      | {
          tokenStore?: AuthTokenStore;
          or?: string;
          includeRestricted?: boolean;
          allowDeletingAccount?: boolean;
        },
  ): Promise<OwnedUser | null> {
    let userId: string;
    let sessionId: string | null = null;
    let request: Headers | undefined;
    if (typeof input === "string") userId = input;
    else {
      request = await authHeaders(input?.tokenStore);
      const principal = await resolveBetterAuthPrincipal(request, {
        allowDeletingAccount: input?.allowDeletingAccount,
      });
      if (!principal) {
        if (input?.or === "redirect") redirect("/handler/sign-in");
        return null;
      }
      userId = principal.userId;
      sessionId = principal.sessionId;
    }
    const [row] = await cloudDb()
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ? ownedUser(row, sessionId, request) : null;
  }
  async getTeam(id: string) {
    const [row] = await cloudDb()
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    return row ? new OwnedTeam(row) : null;
  }
  async createTeam(input: { displayName: string; creatorUserId?: string }) {
    const id = randomUUID();
    const row = await cloudDb().transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({
          id,
          name: input.displayName,
          slug: `org-${id}`,
          createdAt: new Date(),
        })
        .returning();
      if (!organization)
        throw new Error("Organization creation returned no row");
      if (input.creatorUserId)
        await tx
          .insert(members)
          .values({
            id: randomUUID(),
            organizationId: id,
            userId: input.creatorUserId,
            role: "owner",
            createdAt: new Date(),
          });
      return organization;
    });
    return new OwnedTeam(row);
  }
  async listTeamMemberPermissions(
    id: string,
    _options?: { recursive?: boolean },
  ) {
    void _options;
    return (
      await cloudDb()
        .select()
        .from(members)
        .where(eq(members.organizationId, id))
    ).flatMap((row) =>
      permissions(row.role).map((permissionId) => ({
        userId: row.userId,
        permissionId,
      })),
    );
  }
  async listUsers(options: ListOptions = {}): Promise<AuthPage<OwnedUser>> {
    const limit = Math.min(options.limit ?? 100, 1000);
    const conditions = [];
    if (options.cursor) conditions.push(gt(users.id, options.cursor));
    if (options.query)
      conditions.push(
        or(
          ilike(users.email, `%${options.query}%`),
          ilike(users.name, `%${options.query}%`),
          eq(users.id, options.query),
        )!,
      );
    if (!options.includeAnonymous)
      conditions.push(eq(users.isAnonymous, false));
    const rows = await cloudDb()
      .select()
      .from(users)
      .where(and(...conditions))
      .orderBy(asc(users.id))
      .limit(limit + 1);
    return page(
      await Promise.all(rows.map((row) => ownedUser(row))),
      limit,
      (user) => user.id,
    );
  }
  async listTeams(options: ListOptions = {}): Promise<AuthPage<OwnedTeam>> {
    const limit = Math.min(options.limit ?? 100, 1000);
    const conditions = [];
    if (options.cursor) conditions.push(gt(organizations.id, options.cursor));
    if (options.query)
      conditions.push(
        or(
          ilike(organizations.name, `%${options.query}%`),
          eq(organizations.id, options.query),
        )!,
      );
    const rows = await cloudDb()
      .select()
      .from(organizations)
      .where(and(...conditions))
      .orderBy(asc(organizations.id))
      .limit(limit + 1);
    return page(
      rows.map((row) => new OwnedTeam(row)),
      limit,
      (team) => team.id,
    );
  }
  async createUser(input: {
    displayName?: string | null;
    primaryEmail?: string | null;
    primaryEmailVerified?: boolean;
    isAnonymous?: boolean;
    clientReadOnlyMetadata?: unknown;
    serverMetadata?: unknown;
  }) {
    const id = randomUUID();
    const now = new Date();
    const [row] = await cloudDb()
      .insert(users)
      .values({
        id,
        name: input.displayName ?? "",
        email: input.primaryEmail ?? `${id}@anonymous.invalid`,
        emailVerified: input.primaryEmailVerified ?? false,
        isAnonymous: input.isAnonymous ?? false,
        clientReadOnlyMetadata: metadata(input.clientReadOnlyMetadata),
        serverMetadata: metadata(input.serverMetadata),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new Error("User creation returned no row");
    return ownedUser(row);
  }
  async getProject() {
    return {
      displayName: "cmux W3Dev",
      config: {
        credentialEnabled: true,
        passkeyEnabled: true,
        magicLinkEnabled: true,
        allowUserApiKeys: false,
        allowTeamApiKeys: false,
        clientUserDeletionEnabled: true,
        oauthProviders: [
          ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
            ? [{ id: "google" }]
            : []),
          ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
            ? [{ id: "github" }]
            : []),
        ],
      },
    };
  }
  async getAuthJson(
    input: { tokenStore?: AuthTokenStore; allowDeletingAccount?: boolean } = {},
  ): Promise<AuthJson> {
    const request = await authHeaders(input.tokenStore);
    const principal = await resolveBetterAuthPrincipal(request, {
      allowDeletingAccount: input?.allowDeletingAccount,
    });
    if (!principal) return { accessToken: null, refreshToken: null };
    const bearer = request.get("authorization");
    return {
      accessToken: bearer?.toLowerCase().startsWith("bearer ")
        ? bearer.slice(7)
        : await getBetterAuthBrowserAccessToken(request),
      refreshToken: null,
    };
  }
  async sendMagicLinkEmail(email: string, options?: { callbackUrl?: string }) {
    await getBetterAuth().api.signInMagicLink({
      body: { email, callbackURL: ownedAuthCallback(options?.callbackUrl) },
      headers: new Headers({ origin: applicationOrigin() }),
    });
    return { status: "ok" as const };
  }
  async signOut(input: { tokenStore?: AuthTokenStore } = {}) {
    const request = await authHeaders(input.tokenStore);
    if (request.has("authorization"))
      await Effect.runPromise(revokeBetterAuthSession(request));
    else await getBetterAuth().api.signOut({ headers: request });
  }
}
function ownedAuthCallback(value?: string): string {
  const origin = applicationOrigin();
  const callback = new URL(value ?? "/handler/after-sign-in", origin);
  if (callback.origin !== origin || callback.username || callback.password) {
    throw new Error("Authentication callback must use the configured application origin");
  }
  return callback.toString();
}
const serverApp = new OwnedAuthServerApp();
export function isStackConfigured() {
  return Boolean(
    process.env.BETTER_AUTH_SECRET &&
    (process.env.DATABASE_URL || process.env.DIRECT_DATABASE_URL),
  );
}
export function getStackServerApp() {
  return serverApp;
}
export function createUncachedStackServerApp() {
  return new OwnedAuthServerApp();
}
export function getNonRedirectingStackServerApp() {
  return serverApp;
}
export const stackServerApp = isStackConfigured() ? serverApp : null;
const currentUser = cache(() => serverApp.getUser({ or: "return-null" }));
export function getRequestScopedStackUser(_flow: string) {
  void _flow;
  return currentUser();
}
export async function markStackUserEmailVerifiedViaApi(
  id: string,
  email: string,
) {
  const user = await serverApp.getUser(id);
  if (!user) throw new Error("User not found");
  await user.setPrimaryEmail(email, { verified: true });
}
export async function promoteStackUserFromAnonymousViaApi(
  id: string,
  email: string,
) {
  const user = await serverApp.getUser(id);
  if (
    !user ||
    !user.primaryEmailVerified ||
    canonicalizeEmailForMatching(user.primaryEmail) !==
      canonicalizeEmailForMatching(email)
  )
    throw new Error("Verified email is required to promote an anonymous user");
  await user.update({ isAnonymous: false });
}
export async function promoteStackUserFromAnonymousWithDeletionGuard(
  userId: string,
  email: string,
) {
  await withFreshAccountMetadataUser({
    db: cloudDb(),
    userId,
    loader: serverApp,
    operation: async (user, lease) => {
      if (
        !user.isAnonymous ||
        !user.primaryEmailVerified ||
        canonicalizeEmailForMatching(user.primaryEmail) !==
          canonicalizeEmailForMatching(email)
      )
        throw new Error("Anonymous promotion precondition changed");
      await lease.refresh();
      await promoteStackUserFromAnonymousViaApi(user.id, email);
    },
  });
}
