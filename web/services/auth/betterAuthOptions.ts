import { randomUUID } from "node:crypto";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { anonymous, emailOTP, jwt, magicLink, organization } from "better-auth/plugins";
import { oauthProvider, type OAuthOptions } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { deployment } from "../deployment/config";
import { applicationOrigin } from "../deployment/origin";
import { deliverBetterAuthMail } from "./betterAuthMail";
import { betterAuthMailTemplate } from "./betterAuthMailTemplate";
import { betterAuthResourcePlugin } from "./betterAuthResource";
import { betterAuthMfa } from "./betterAuthMfa";

const metadataField = { type: "json", required: false, defaultValue: {}, input: false } as const;

const snakeCase = (value: string) => value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z])([A-Z][a-z])/g, "$1_$2").toLowerCase();
const fieldNames = (fields: string[]) => Object.fromEntries(fields.map(field => [field, snakeCase(field)]));

// The pg adapter uses explicit fieldName; Drizzle's generated schema uses snake case.
function mapPluginFields<T extends BetterAuthPlugin>(plugin: T): T {
  for (const model of Object.values(plugin.schema ?? {})) {
    for (const [name, field] of Object.entries(model.fields)) field.fieldName = snakeCase(name);
  }
  return plugin;
}

/** Pure configuration shared by runtime and schema generation. No database writes at startup. */
export function betterAuthOptions(origin = applicationOrigin()) {
  const resource = `${origin}/api`;
  const issuer = `${origin}/api/auth`;
  const oauthOptions = {
    loginPage: "/handler/sign-in",
    consentPage: "/handler/oauth-consent",
    scopes: ["openid", "profile", "email", "offline_access", "cmux:api"],
    grantTypes: ["authorization_code", "refresh_token"],
    allowDynamicClientRegistration: false,
    allowUnauthenticatedClientRegistration: false,
    clientPrivileges: () => false,
    resourcePrivileges: () => false,
    accessTokenExpiresIn: 300,
    refreshTokenExpiresIn: 30 * 24 * 60 * 60,
    refreshTokenReuseInterval: 30,
    enforcePerClientResources: true,
    schema: {
      oauthClient: { modelName: "auth_oauth_client" },
      oauthRefreshToken: { modelName: "auth_oauth_refresh_token" },
      oauthAccessToken: { modelName: "auth_oauth_access_token" },
      oauthConsent: { modelName: "auth_oauth_consent" },
      oauthClientAssertion: { modelName: "auth_oauth_client_assertion" },
      oauthResource: { modelName: "auth_oauth_resource" },
      oauthClientResource: { modelName: "auth_oauth_client_resource" },
    },
  } satisfies OAuthOptions<string[]>;
  const socialProviders: BetterAuthOptions["socialProviders"] = {};
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
  }
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET };
  }
  return {
    appName: "cmux W3Dev",
    baseURL: origin,
    basePath: "/api/auth",
    trustedOrigins: [origin, `${deployment.native.macOSCallbackScheme}://auth-callback`, `${deployment.native.iOSCallbackScheme}://auth-callback`],
    // Organization mutations belong to the app's team services, which also revoke
    // VM access and enforce last-admin rules. These paths are HTTP-only disabled;
    // trusted server auth.api calls retain the plugin implementation.
    disabledPaths: ["/token", "/cmux/browser-token", "/cmux/verify-token", "/organization/create", "/organization/update", "/organization/delete",
      "/organization/add-member", "/organization/remove-member", "/organization/update-member-role",
      "/organization/invite-member", "/organization/cancel-invitation", "/organization/accept-invitation",
      "/organization/reject-invitation", "/organization/set-active", "/organization/leave"],
    socialProviders,
    user: {
      modelName: "auth_user",
      fields: fieldNames(["emailVerified", "createdAt", "updatedAt"]),
      additionalFields: {
        clientMetadata: { ...metadataField, fieldName: "client_metadata", input: true },
        clientReadOnlyMetadata: { ...metadataField, fieldName: "client_read_only_metadata" },
        serverMetadata: { ...metadataField, fieldName: "server_metadata", returned: false },
        selectedTeamId: { type: "string", fieldName: "selected_team_id", required: false, input: false },
      },
      changeEmail: { enabled: true },
      deleteUser: { enabled: false },
    },
    session: { modelName: "auth_session", fields: fieldNames(["expiresAt", "createdAt", "updatedAt", "ipAddress", "userAgent", "userId"]), expiresIn: 30 * 24 * 60 * 60, cookieCache: { enabled: false } },
    account: { modelName: "auth_account", fields: fieldNames(["accountId", "providerId", "userId", "accessToken", "refreshToken", "idToken", "accessTokenExpiresAt", "refreshTokenExpiresAt", "createdAt", "updatedAt"]), accountLinking: { enabled: true, trustedProviders: ["google", "github"] } },
    verification: { modelName: "auth_verification", fields: fieldNames(["expiresAt", "createdAt", "updatedAt"]), storeInDatabase: true },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }, request?: Request) => {
        await deliverBetterAuthMail({ to: user.email, ...await betterAuthMailTemplate("reset", { url }, request) });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }, request?: Request) => {
        await deliverBetterAuthMail({ to: user.email, ...await betterAuthMailTemplate("verify", { url }, request) });
      },
    },
    advanced: { database: { generateId: "uuid" }, cookiePrefix: "cmux-w3dev", ipAddress: { ipAddressHeaders: ["x-real-ip"] } },
    rateLimit: { enabled: true, storage: "database", modelName: "auth_rate_limit", fields: { lastRequest: "last_request" } },
    databaseHooks: {
      user: { create: { after: async (user, ctx) => {
        if (!ctx || (user as { isAnonymous?: boolean }).isAnonymous) return;
        const organizationId = randomUUID();
        await ctx.context.adapter.transaction(async adapter => {
          await adapter.create({ model: "organization", forceAllowId: true, data: {
            id: organizationId, name: user.name || user.email, slug: `personal-${organizationId}`, createdAt: new Date(),
          } });
          await adapter.create({ model: "member", forceAllowId: true, data: {
            id: randomUUID(), organizationId, userId: user.id, role: "owner", createdAt: new Date(),
          } });
          await adapter.update({ model: "user", where: [{ field: "id", value: user.id }], update: { selectedTeamId: organizationId } });
          await adapter.updateMany({ model: "session", where: [{ field: "userId", value: user.id }, { field: "activeOrganizationId", value: null }], update: { activeOrganizationId: organizationId } });
        });
      } } },
      session: { create: { before: async (session, ctx) => {
        if (!ctx) return;
        const membership = await ctx.context.adapter.findOne<{ organizationId: string }>({ model: "member", where: [{ field: "userId", value: session.userId }] });
        return { data: { ...session, activeOrganizationId: membership?.organizationId ?? null } };
      } } },
    },
    plugins: [
      mapPluginFields(organization({
        allowUserToCreateOrganization: user => user.emailVerified && user.isAnonymous !== true,
        requireEmailVerificationOnInvitation: true,
        schema: {
          organization: { modelName: "auth_organization", additionalFields: { clientReadOnlyMetadata: metadataField, serverMetadata: { ...metadataField, returned: false } } },
          member: { modelName: "auth_member", additionalFields: { displayName: { type: "string", required: false, input: false }, image: { type: "string", required: false, input: false } } },
          invitation: { modelName: "auth_invitation" },
        },
        sendInvitationEmail: async (invitation, request) => {
          const url = `${origin}/teams/join/${encodeURIComponent(invitation.id)}`;
          await deliverBetterAuthMail({ to: invitation.email, ...await betterAuthMailTemplate("invite", { url, organization: invitation.organization.name }, request) });
        },
      })),
      emailOTP({ storeOTP: "hashed", allowedAttempts: 5, expiresIn: 600,
        sendVerificationOTP: async ({ email, otp }, ctx) => {
          await deliverBetterAuthMail({ to: email, ...await betterAuthMailTemplate("otp", { otp }, ctx?.request) });
        },
      }),
      magicLink({ expiresIn: 900, storeToken: "hashed", sendMagicLink: async ({ email, url }, ctx) => {
        await deliverBetterAuthMail({ to: email, ...await betterAuthMailTemplate("magic", { url }, ctx?.request) });
      } }),
      mapPluginFields(anonymous({ emailDomainName: `anonymous.${new URL(origin).hostname}` })),
      mapPluginFields(betterAuthMfa(origin)),
      mapPluginFields(passkey({ rpName: "cmux W3Dev", rpID: new URL(origin).hostname, origin, schema: { passkey: { modelName: "auth_passkey" } } })),
      mapPluginFields(jwt({ jwt: { issuer, audience: resource }, jwks: { keyPairConfig: { alg: "ES256" } }, schema: { jwks: { modelName: "auth_jwks" } } })),
      mapPluginFields(oauthProvider(oauthOptions)),
      betterAuthResourcePlugin(oauthOptions, resource, deployment.native.webOAuthClientID),
    ],
  } as const satisfies BetterAuthOptions;
}
