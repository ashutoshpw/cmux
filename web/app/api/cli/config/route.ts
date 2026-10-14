import { applicationOrigin } from "../../../../services/deployment/origin";
/** CLI builds must opt into the OAuth provider contract; no legacy provider key is published. */
export function GET(_request?: Request): Response {
  const origin = applicationOrigin();
  return Response.json({ version: 5, clientContract: "better-auth-oauth-pkce-v1", auth: { provider: "better-auth", issuer: `${origin}/api/auth`, resource: `${origin}/api`, authorizationEndpoint: `${origin}/api/auth/oauth2/authorize`, tokenEndpoint: `${origin}/api/auth/oauth2/token`, scopes: ["openid", "profile", "email", "offline_access", "cmux:api"], deviceAuthorizationAvailable: false }, coderouter: { sessionUrl: `${origin}/api/coderouter/session`, accountsUrl: `${origin}/api/coderouter/accounts`, organizationsUrl: `${origin}/api/coderouter/organizations`, apiKeysSelfUrl: `${origin}/api/coderouter/api-keys/self`, openaiBaseUrl: `${origin}/v1` } }, { headers: { "cache-control": "no-store" } });
}
