import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import { getOAuthProviderApi, type OAuthOptions } from "@better-auth/oauth-provider";

export type VerifiedOAuthIdentity = {
  userId: string;
  sessionId: string;
  scopes: string[];
};

/** Use the provider's verifier so revocation, disabled clients and signatures share one owner. */
export function betterAuthResourcePlugin(options: OAuthOptions<string[]>, resource: string, webClientId: string) {
  return {
    id: "cmux-resource",
    endpoints: {
      cmuxVerifyToken: createAuthEndpoint("/cmux/verify-token", {
        method: "GET",
        requireHeaders: true,
        metadata: { SERVER_ONLY: true },
      }, async (ctx): Promise<VerifiedOAuthIdentity> => {
        const authorization = ctx.headers.get("authorization");
        if (!authorization?.startsWith("Bearer ")) throw new APIError("UNAUTHORIZED");
        const payload = await getOAuthProviderApi(ctx, options).requireActiveAccessToken(authorization.slice(7));
        const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
        if (!audiences.includes(resource) || !scopes.includes("cmux:api")
          || typeof payload.sub !== "string" || typeof payload.sid !== "string" || typeof payload.exp !== "number") {
          throw new APIError("UNAUTHORIZED");
        }
        const resourceGrant = await ctx.context.adapter.findOne({ model: "oauthClientResource", where: [
          { field: "clientId", value: String(payload.client_id) }, { field: "resourceId", value: resource },
        ] });
        if (!resourceGrant) throw new APIError("UNAUTHORIZED");
        const session = await ctx.context.adapter.findOne<{ id: string; userId: string; expiresAt: Date }>({
          model: "session", where: [{ field: "id", value: payload.sid }],
        });
        if (!session || session.userId !== payload.sub || session.expiresAt <= new Date()) throw new APIError("UNAUTHORIZED");
        return { userId: payload.sub, sessionId: payload.sid, scopes };
      }),
      cmuxBrowserToken: createAuthEndpoint("/cmux/browser-token", {
        method: "GET",
        requireHeaders: true,
        use: [sessionMiddleware],
        metadata: { SERVER_ONLY: true },
      }, async (ctx) => {
        const { user, session } = ctx.context.session;
        if (!user.emailVerified || (user as { isAnonymous?: boolean }).isAnonymous) throw new APIError("UNAUTHORIZED");
        const provider = getOAuthProviderApi(ctx, options, "authorization_code");
        const client = await provider.getClient(webClientId);
        if (!client || client.disabled) throw new APIError("SERVICE_UNAVAILABLE");
        const resourceGrant = await ctx.context.adapter.findOne({ model: "oauthClientResource", where: [
          { field: "clientId", value: webClientId }, { field: "resourceId", value: resource },
        ] });
        if (!resourceGrant) throw new APIError("SERVICE_UNAVAILABLE");
        return provider.issueTokens({ client, user, sessionId: session.id,
          scopes: ["openid", "profile", "email", "cmux:api"], resources: [resource] });
      }),
    },
  } satisfies BetterAuthPlugin;
}
