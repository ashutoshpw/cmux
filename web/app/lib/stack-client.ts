"use client";

import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";
import {
  emailOTPClient,
  organizationClient,
  twoFactorClient,
  anonymousClient,
} from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createElement, type ReactNode, useEffect, useMemo } from "react";

export const authClient = createAuthClient({
  plugins: [
    oauthProviderClient(),
    emailOTPClient(),
    organizationClient(),
    twoFactorClient(),
    anonymousClient(),
    passkeyClient(),
  ],
});
type Result =
  | { status: "ok" }
  | { status: "error"; error: { message: string; errorCode: string } };
async function checked<T>(
  request: Promise<{
    data: T | null;
    error: { message?: string; code?: string } | null;
  }>,
): Promise<T> {
  const result = await request;
  if (result.error || result.data === null)
    throw new Error(result.error?.message ?? "Authentication request failed");
  return result.data;
}
async function provider<T>(
  action: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("/api/account/provider", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...data }),
  });
  if (!response.ok) throw new Error("Account request failed");
  return response.json();
}
async function result(request: Promise<unknown>): Promise<Result> {
  try {
    await request;
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      error: {
        message:
          error instanceof Error
            ? error.message
            : "Authentication request failed",
        errorCode: "AUTHENTICATION_FAILED",
      },
    };
  }
}
function navigate(path: string) {
  window.location.assign(path);
}
export const PROJECT_CONFIG = {
  credentialEnabled: true,
  passkeyEnabled: true,
  magicLinkEnabled: true,
  allowUserApiKeys: false,
  allowTeamApiKeys: false,
  clientUserDeletionEnabled: true,
  oauthProviders: [] as { id: string }[],
};
export type Project = { displayName: string; config: typeof PROJECT_CONFIG };
export type CurrentUserContactChannel = {
  id: string;
  type: "email";
  value: string;
  isPrimary: boolean;
  isVerified: boolean;
  usedForAuth: boolean;
  sendVerificationEmail(): Promise<void>;
  update(input: { isPrimary?: boolean; usedForAuth?: boolean }): Promise<void>;
  delete(): Promise<void>;
};
export type OAuthProvider = {
  id: string;
  type: string;
  email: string | null;
  allowSignIn: boolean;
  allowConnectedAccounts: boolean;
  delete(): Promise<void>;
  update(input: { allowSignIn?: boolean }): Promise<Result>;
};
export type Key = {
  id: string;
  description: string;
  createdAt: Date;
  expiresAt: Date | null;
  manuallyRevokedAt: Date | null;
  value: { lastFour: string };
  whyInvalid(): "manually-revoked" | "expired" | null;
  revoke(): Promise<void>;
};
export type FirstKey = {
  id: string;
  description: string;
  createdAt: Date;
  expiresAt: Date | null;
  value: string;
};
type KeyInput = {
  description: string;
  expiresAt?: Date | null;
  expiresInMillis?: number | null;
};
function keys(
  rows: {
    id: string;
    description: string;
    createdAt: string;
    expiresAt: string | null;
    manuallyRevokedAt: string | null;
    lastFour: string;
  }[],
  teamId?: string,
): Key[] {
  return rows.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt),
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    manuallyRevokedAt: row.manuallyRevokedAt
      ? new Date(row.manuallyRevokedAt)
      : null,
    value: { lastFour: row.lastFour },
    whyInvalid() {
      return this.manuallyRevokedAt
        ? "manually-revoked"
        : this.expiresAt && this.expiresAt <= new Date()
          ? "expired"
          : null;
    },
    revoke: () => provider("revoke-key", { keyId: row.id, teamId }),
  }));
}
async function newKey(input: KeyInput, teamId?: string): Promise<FirstKey> {
  const row = await provider<{
    id: string;
    description: string;
    createdAt: string;
    expiresAt: string | null;
    key: string;
  }>("create-key", { ...input, teamId });
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    value: row.key,
  };
}
export class Team {
  constructor(
    readonly id: string,
    readonly displayName: string,
    readonly profileImageUrl: string | null = null,
  ) {}
  async listApiKeys() {
    return keys(await provider("list-keys", { teamId: this.id }), this.id);
  }
  createApiKey(input: KeyInput) {
    return newKey(input, this.id);
  }
}
export type UserSnapshot = {
  id: string;
  displayName: string | null;
  primaryEmail: string | null;
  primaryEmailVerified: boolean;
  profileImageUrl: string | null;
  isAnonymous: boolean;
  hasPassword: boolean;
  passkeyAuthEnabled: boolean;
  isMultiFactorRequired: boolean;
  clientMetadata: Record<string, unknown>;
  clientReadOnlyMetadata: Record<string, unknown>;
  teams: {
    id: string;
    name: string;
    image: string | null;
    memberDisplayName: string | null;
    memberImage: string | null;
  }[];
  selectedTeamId: string | null;
  oauthProviders: { id: string }[];
  project: Project;
};
export class CurrentUser {
  constructor(
    private readonly row: UserSnapshot,
    private readonly refresh: () => Promise<unknown>,
  ) {}
  get id() {
    return this.row.id;
  }
  get displayName() {
    return this.row.displayName;
  }
  get primaryEmail() {
    return this.row.primaryEmail;
  }
  get primaryEmailVerified() {
    return this.row.primaryEmailVerified;
  }
  get profileImageUrl() {
    return this.row.profileImageUrl;
  }
  get isAnonymous() {
    return this.row.isAnonymous;
  }
  get hasPassword() {
    return this.row.hasPassword;
  }
  get otpAuthEnabled() {
    return true;
  }
  get passkeyAuthEnabled() {
    return this.row.passkeyAuthEnabled;
  }
  get isMultiFactorRequired() {
    return this.row.isMultiFactorRequired;
  }
  get oauthProviders() {
    return this.row.oauthProviders;
  }
  get clientMetadata() {
    return this.row.clientMetadata;
  }
  get clientReadOnlyMetadata() {
    return this.row.clientReadOnlyMetadata;
  }
  get selectedTeam() {
    return this.useTeam(this.row.selectedTeamId ?? "");
  }
  async update(input: {
    displayName?: string | null;
    profileImageUrl?: string | null;
    selectedTeamId?: string | null;
    clientMetadata?: unknown;
    otpAuthEnabled?: boolean;
    passkeyAuthEnabled?: boolean;
    totpMultiFactorSecret?: string | Uint8Array | null;
  }) {
    if (input.displayName !== undefined || input.profileImageUrl !== undefined)
      await checked(
        authClient.updateUser({
          name: input.displayName ?? undefined,
          image: input.profileImageUrl,
        }),
      );
    if (input.selectedTeamId !== undefined)
      await provider("select-organization", {
        organizationId: input.selectedTeamId,
      });
    if (input.clientMetadata !== undefined)
      await provider("update-preferences", {
        clientMetadata: input.clientMetadata,
      });
    if (input.passkeyAuthEnabled === false) {
      for (const key of await checked(authClient.passkey.listUserPasskeys()))
        await checked(authClient.passkey.deletePasskey({ id: key.id }));
    }
    if (input.otpAuthEnabled === false)
      throw new Error(
        "Email verification codes are required for account recovery",
      );
    if (input.totpMultiFactorSecret !== undefined)
      throw new Error("Use the verified two-factor enrollment flow");
    await this.refresh();
  }
  async listContactChannels(): Promise<CurrentUserContactChannel[]> {
    if (!this.primaryEmail) return [];
    return [
      {
        id: this.id,
        type: "email",
        value: this.primaryEmail,
        isPrimary: true,
        isVerified: this.primaryEmailVerified,
        usedForAuth: true,
        sendVerificationEmail: async () => {
          await checked(
            authClient.sendVerificationEmail({
              email: this.primaryEmail!,
              callbackURL: "/handler/after-sign-in",
            }),
          );
        },
        update: async () => {
          throw new Error("Use account email change with verification");
        },
        delete: async () => {
          throw new Error("The primary sign-in email cannot be removed");
        },
      },
    ];
  }
  async createContactChannel(_input: {
    type: string;
    value: string;
    usedForAuth?: boolean;
  }): Promise<CurrentUserContactChannel> {
    void _input;
    throw new Error("Only the verified primary account email is supported");
  }
  async updatePassword(input: { oldPassword: string; newPassword: string }) {
    const response = await result(
      checked(
        authClient.changePassword({
          currentPassword: input.oldPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: true,
        }),
      ),
    );
    await this.refresh();
    return response;
  }
  async setPassword(input: { password: string }) {
    const response = await result(
      provider("set-password", { newPassword: input.password }),
    );
    await this.refresh();
    return response;
  }
  async registerPasskey() {
    const response = await result(checked(authClient.passkey.addPasskey()));
    await this.refresh();
    return response;
  }
  async revokeSession(id: string) {
    await provider("revoke-session", { sessionId: id });
    await this.refresh();
  }
  async listOAuthProviders(): Promise<OAuthProvider[]> {
    return (await checked(authClient.listAccounts()))
      .filter((account) => account.providerId !== "credential")
      .map((account) => ({
        id: account.providerId,
        type: account.providerId,
        email: this.primaryEmail,
        allowSignIn: true,
        allowConnectedAccounts: true,
        update: async (input: { allowSignIn?: boolean }): Promise<Result> => {
          if (input.allowSignIn === false) {
            await checked(authClient.unlinkAccount({ accountId: account.id }));
            await this.refresh();
          }
          return { status: "ok" };
        },
        delete: async () => {
          await checked(authClient.unlinkAccount({ accountId: account.id }));
          await this.refresh();
        },
      }));
  }
  async getTeam(id: string) {
    return this.useTeam(id);
  }
  useTeam(id: string) {
    const team = this.row.teams.find((team) => team.id === id);
    return team ? new Team(team.id, team.name, team.image) : null;
  }
  useTeamProfile(team: Team) {
    const member = this.row.teams.find((row) => row.id === team.id);
    return {
      displayName: member?.memberDisplayName ?? null,
      profileImageUrl: member?.memberImage ?? null,
      update: async (input: {
        displayName?: string | null;
        profileImageUrl?: string | null;
      }) => {
        await provider("team-profile", { teamId: team.id, ...input });
        await this.refresh();
      },
    };
  }
  async listApiKeys() {
    return keys(await provider("list-keys"));
  }
  createApiKey(input: KeyInput) {
    return newKey(input);
  }
  async listNotificationCategories() {
    const rows =
      await provider<
        { id: string; name: string; enabled: boolean; canDisable: boolean }[]
      >("notifications");
    return rows.map((row) => ({
      ...row,
      setEnabled: async (enabled: boolean) => {
        await provider("notification", { categoryId: row.id, enabled });
        await this.refresh();
      },
    }));
  }
  async delete() {
    const { accessToken } = await stackClientApp.getAuthJson();
    if (!accessToken) throw new Error("Authentication required");
    const response = await fetch("/api/account", {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirmation: "DELETE" }),
    });
    if (!response.ok) throw new Error("Account deletion failed");
    await checked(authClient.signOut());
  }
}
async function snapshot(): Promise<UserSnapshot | null> {
  const response = await fetch("/api/account/provider", { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Account unavailable");
  return response.json();
}
export function useUser(
  options: { or?: "redirect" | "return-null"; includeRestricted?: boolean } & {
    or: "redirect";
  },
): CurrentUser;
export function useUser(options?: {
  or?: "redirect" | "return-null";
  includeRestricted?: boolean;
}): CurrentUser | null;
export function useUser(
  options: { or?: string; includeRestricted?: boolean } = {},
) {
  const session = authClient.useSession();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["owned-auth-user", session.data?.user.id],
    queryFn: snapshot,
    enabled: typeof window !== "undefined" && !session.isPending,
    staleTime: 0,
  });
  const user = useMemo(() => query.data ? new CurrentUser(query.data, () => queryClient.invalidateQueries({ queryKey: ["owned-auth-user"] })) : null, [query.data, queryClient]);
  useEffect(() => {
    if (
      !session.isPending &&
      !query.isPending &&
      !user &&
      options.or === "redirect"
    )
      navigate("/handler/sign-in");
  }, [session.isPending, query.isPending, user, options.or]);
  if (query.error) throw query.error;
  if (options.or === "redirect" && !user) {
    if (typeof window === "undefined") throw new Promise<void>(() => {});
    if (session.isPending || query.isPending)
      throw authClient.getSession().then(() => query.refetch());
    window.location.replace("/handler/sign-in");
    throw new Promise<void>(() => {});
  }
  return user;
}
export const stackClientApp = {
  useUser,
  useProject: (): Project => ({
    displayName: "cmux W3Dev",
    config: PROJECT_CONFIG,
  }),
  getUser: async (_options?: { includeRestricted?: boolean }) => {
    void _options;
    const row = await snapshot();
    return row ? new CurrentUser(row, async () => {}) : null;
  },
  getAuthJson: async () => {
    const response = await fetch("/api/account/provider/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    if (!response.ok) throw new Error("Account token unavailable");
    return response.json() as Promise<AuthJson>;
  },
  signOut: async (input?: { redirectUrl?: string }) => {
    await checked(authClient.signOut());
    if (input?.redirectUrl) navigate(input.redirectUrl);
  },
  redirectToHome: async () => navigate("/"),
  redirectToSignIn: async (_options?: unknown) => { void _options; navigate("/handler/sign-in"); },
  redirectToAfterSignIn: async (_options?: unknown) => { void _options; navigate("/handler/after-sign-in"); },
  redirectToAfterSignUp: async (_options?: unknown) => { void _options; navigate("/handler/after-sign-in"); },
  redirectToOnboarding: async (_options?: unknown) => { void _options; navigate("/handler/after-sign-in"); },
  getTeamInvitationDetails: async (code: string) => {
    const response = await checked(
      authClient.organization.getInvitation({ query: { id: code } }),
    );
    return {
      teamDisplayName: response.organizationName,
      teamId: response.organizationId,
    };
  },
  acceptTeamInvitation: async (code: string) => {
    const response = await fetch("/api/teams/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) throw new Error("Invitation acceptance failed");
    return response.json();
  },
  signInWithOAuth: async (
    providerId: string,
    input?: { returnTo?: string; loginHint?: string },
  ) =>
    checked(
      authClient.signIn.social({
        provider: providerId,
        callbackURL: input?.returnTo ?? "/handler/after-sign-in",
      }),
    ),
  signInWithPasskey: async () => result(checked(authClient.signIn.passkey())),
};
type AuthJson = { accessToken: string | null; refreshToken: null };
export function useStackApp() {
  return stackClientApp;
}
export const useHexclaveApp = useStackApp;
export function StackProvider({
  children,
}: {
  children: ReactNode;
  app?: unknown;
}) {
  return children;
}
export function StackTheme({ children }: { children: ReactNode }) {
  return children;
}
export function UserAvatar({
  user,
  size = 24,
}: {
  user: {
    displayName?: string | null;
    primaryEmail?: string | null;
    profileImageUrl?: string | null;
  } | null;
  size?: number;
}) {
  return user?.profileImageUrl
    ? createElement("img", {
        src: user.profileImageUrl,
        width: size,
        height: size,
        alt: user.displayName ?? "",
        className: "rounded-full object-cover",
      })
    : createElement(
        "span",
        {
          style: { width: size, height: size },
          className:
            "inline-flex shrink-0 items-center justify-center rounded-full bg-code-bg",
          "aria-hidden": true,
        },
        (user?.displayName ?? user?.primaryEmail ?? "?")
          .slice(0, 1)
          .toUpperCase(),
      );
}
