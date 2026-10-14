import { getBetterAuth } from "../../../../services/auth/betterAuthServer";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getStackServerApp, type OwnedUser } from "../../../lib/stack";
import { cloudDb } from "../../../../db/client";
import {
  betterAuthAccount,
  betterAuthMember,
  betterAuthPasskey,
  betterAuthSession,
  betterAuthUser,
} from "../../../../db/betterAuthSchema";
import { nativeAuthMutationAllowed } from "../../../../services/auth/betterAuthNativeRoute";

async function current(request: Request) {
  return getStackServerApp().getUser({
    tokenStore: request,
    or: "return-null",
  });
}
export async function GET(request: Request): Promise<Response> {
  const user = await current(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const [memberships, accounts, passkeys, row, project] = await Promise.all([
    cloudDb()
      .select()
      .from(betterAuthMember)
      .where(eq(betterAuthMember.userId, user.id)),
    cloudDb()
      .select({
        providerId: betterAuthAccount.providerId,
        password: betterAuthAccount.password,
      })
      .from(betterAuthAccount)
      .where(eq(betterAuthAccount.userId, user.id)),
    cloudDb()
      .select({ id: betterAuthPasskey.id })
      .from(betterAuthPasskey)
      .where(eq(betterAuthPasskey.userId, user.id)),
    cloudDb()
      .select({ twoFactorEnabled: betterAuthUser.twoFactorEnabled })
      .from(betterAuthUser)
      .where(eq(betterAuthUser.id, user.id)),
    getStackServerApp().getProject(),
  ]);
  const teams = await user.listTeams({ limit: 1000 });
  return Response.json(
    {
      id: user.id,
      displayName: user.displayName,
      primaryEmail: user.primaryEmail,
      primaryEmailVerified: user.primaryEmailVerified,
      profileImageUrl: user.profileImageUrl,
      isAnonymous: user.isAnonymous,
      hasPassword: accounts.some(
        (account) => account.providerId === "credential" && !!account.password,
      ),
      passkeyAuthEnabled: passkeys.length > 0,
      isMultiFactorRequired: row[0]?.twoFactorEnabled === true,
      clientMetadata: user.clientMetadata,
      clientReadOnlyMetadata: user.clientReadOnlyMetadata,
      selectedTeamId: user.selectedTeam?.id ?? null,
      teams: teams.map((team) => ({
        id: team.id,
        name: team.displayName,
        image: team.profileImageUrl,
        memberDisplayName:
          memberships.find((member) => member.organizationId === team.id)
            ?.displayName ?? null,
        memberImage:
          memberships.find((member) => member.organizationId === team.id)
            ?.image ?? null,
      })),
      oauthProviders: accounts
        .filter((account) => account.providerId !== "credential")
        .map((account) => ({ id: account.providerId })),
      project,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
const keyInput = z.object({
  description: z.string().trim().min(1).max(200),
  expiresAt: z.coerce.date().nullable().optional(),
  expiresInMillis: z
    .number()
    .int()
    .positive()
    .max(365 * 86400000)
    .nullable()
    .optional(),
});
const bodySchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("list-keys"), teamId: z.uuid().optional() })
    .strict(),
  keyInput
    .extend({ action: z.literal("create-key"), teamId: z.uuid().optional() })
    .strict(),
  z
    .object({
      action: z.literal("revoke-key"),
      keyId: z.uuid(),
      teamId: z.uuid().optional(),
    })
    .strict(),
  z
    .object({ action: z.literal("revoke-session"), sessionId: z.uuid() })
    .strict(),
  z
    .object({
      action: z.literal("team-profile"),
      teamId: z.uuid(),
      displayName: z.string().max(100).nullable().optional(),
      profileImageUrl: z.string().max(15000).nullable().optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("update-preferences"),
      clientMetadata: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z.object({ action: z.literal("notifications") }).strict(),
  z
    .object({
      action: z.literal("set-password"),
      newPassword: z.string().min(12).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("select-organization"),
      organizationId: z.uuid().nullable(),
    })
    .strict(),
  z
    .object({
      action: z.literal("notification"),
      categoryId: z.literal("product"),
      enabled: z.boolean(),
    })
    .strict(),
]);
async function keyOwner(user: OwnedUser, teamId?: string) {
  if (!teamId) return user;
  const team = await user.getTeam(teamId);
  if (!team || !(await user.hasPermission(team, "$manage_api_keys")))
    return null;
  return team;
}
type KeyAction = Extract<
  z.output<typeof bodySchema>,
  { action: "list-keys" | "create-key" | "revoke-key" }
>;
async function keyAction(user: OwnedUser, body: KeyAction): Promise<Response> {
  const owner = await keyOwner(user, body.teamId);
  if (!owner) return Response.json({ error: "forbidden" }, { status: 403 });
  if (body.action === "create-key")
    return Response.json(
      { error: "api_key_authentication_not_enabled" },
      { status: 501 },
    );
  const keys = await owner.listApiKeys();
  if (body.action === "revoke-key") {
    const key = keys.find((key) => key.id === body.keyId);
    if (!key) return Response.json({ error: "not_found" }, { status: 404 });
    await key.revoke();
  } else
    return Response.json(
      keys.map((key) => ({
        id: key.id,
        description: key.description,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        manuallyRevokedAt: key.manuallyRevokedAt,
        lastFour: key.value.lastFour,
      })),
    );
  return Response.json({ ok: true });
}
export async function POST(request: Request): Promise<Response> {
  if (!nativeAuthMutationAllowed(request))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const user = await current(request);
  if (!user || user.isAnonymous)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const input = bodySchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json({ error: "invalid_request" }, { status: 400 });
  const body = input.data;
  if (
    body.action === "list-keys" ||
    body.action === "create-key" ||
    body.action === "revoke-key"
  ) {
    return keyAction(user, body);
  } else if (body.action === "revoke-session") {
    await cloudDb()
      .delete(betterAuthSession)
      .where(
        and(
          eq(betterAuthSession.userId, user.id),
          eq(betterAuthSession.id, body.sessionId),
        ),
      );
  } else if (body.action === "team-profile") {
    if (!(await user.getTeam(body.teamId)))
      return Response.json({ error: "forbidden" }, { status: 403 });
    await cloudDb()
      .update(betterAuthMember)
      .set({ displayName: body.displayName, image: body.profileImageUrl })
      .where(
        and(
          eq(betterAuthMember.userId, user.id),
          eq(betterAuthMember.organizationId, body.teamId),
        ),
      );
  } else if (body.action === "select-organization") {
    await user.update({ selectedTeamId: body.organizationId });
  } else if (body.action === "set-password") {
    await getBetterAuth().api.setPassword({
      headers: request.headers,
      body: { newPassword: body.newPassword },
    });
  } else if (body.action === "update-preferences") {
    await user.update({ clientMetadata: body.clientMetadata });
  } else if (body.action === "notifications")
    return Response.json(await user.listNotificationCategories());
  else if (body.action === "notification") {
    const value = user.clientMetadata.notifications;
    const notifications =
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value))
        : {};
    await user.update({
      clientMetadata: {
        ...user.clientMetadata,
        notifications: { ...notifications, product: body.enabled },
      },
    });
  }
  return Response.json({ ok: true });
}
