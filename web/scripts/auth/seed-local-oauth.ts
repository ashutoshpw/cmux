import { Data, Effect } from "effect";
import { Pool } from "pg";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deployment } from "../../services/deployment/config";

class LocalOAuthSetupError extends Data.TaggedError("LocalOAuthSetupError")<{ readonly message: string }> {}
const loopback = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const scopes = ["openid", "profile", "email", "offline_access", "cmux:api"];

function sameValues(value: string, expected: string[]): boolean {
  const actual: unknown = JSON.parse(value);
  return Array.isArray(actual) && actual.length === expected.length && expected.every(item => actual.includes(item));
}

function configurationUrl(value: string, label: string): URL {
  try { return new URL(value); }
  catch { throw new LocalOAuthSetupError({ message: `${label} must be a valid URL` }); }
}

function localConfiguration() {
  const rawOrigin = process.env.CMUX_APP_ORIGIN?.trim();
  const databaseURL = process.env.DATABASE_URL?.trim();
  if (!rawOrigin || !databaseURL) throw new LocalOAuthSetupError({ message: "Set explicit CMUX_APP_ORIGIN and DATABASE_URL for a local development database" });
  const origin = configurationUrl(rawOrigin, "CMUX_APP_ORIGIN");
  const database = configurationUrl(databaseURL, "DATABASE_URL");
  if (!loopback.has(origin.hostname) || !["http:", "https:"].includes(origin.protocol)
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new LocalOAuthSetupError({ message: "CMUX_APP_ORIGIN must be an exact loopback HTTP(S) origin" });
  }
  if (!loopback.has(database.hostname) || !["postgres:", "postgresql:"].includes(database.protocol)) {
    throw new LocalOAuthSetupError({ message: "DATABASE_URL must target a loopback PostgreSQL host" });
  }
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new LocalOAuthSetupError({ message: "Local OAuth registration cannot run in a deployed or production runtime" });
  }
  return { origin: origin.origin, databaseURL };
}

function nativeClient(clientId: string | undefined, redirectUri: string | undefined) {
  if (!clientId || !redirectUri || !/^cmux-w3dev-(?:macos|ios)(?:-[a-z0-9-]+)?$/u.test(clientId)) {
    throw new LocalOAuthSetupError({ message: "Pass an explicit fork native --client-id and exact --redirect-uri" });
  }
  const callback = configurationUrl(redirectUri, "The callback");
  if (!/^cmux-w3dev(?:-[a-z0-9-]+)?:$/u.test(callback.protocol) || callback.hostname !== "auth-callback"
    || callback.pathname || callback.username || callback.password || callback.port || callback.search || callback.hash) {
    throw new LocalOAuthSetupError({ message: "The callback must be an exact fork scheme://auth-callback URI without path, query or wildcard" });
  }
  return { clientId, redirectUri };
}

/** Register one explicit native development client and its exact loopback API resource. */
export function seedLocalOAuthClient(clientId: string | undefined, redirectUri: string | undefined) {
  return Effect.tryPromise({
    try: async () => {
      const configuration = localConfiguration();
      const client = nativeClient(clientId, redirectUri);
      const resource = `${configuration.origin}/api`;
      const pool = new Pool({ connectionString: configuration.databaseURL, max: 1, connectionTimeoutMillis: 5_000, query_timeout: 10_000 });
      try {
        const connection = await pool.connect();
        try {
          await connection.query("begin");
          const existing = await connection.query("select redirect_uris, application_type, token_endpoint_auth_method, require_pkce, grant_types, response_types, scopes, disabled from auth_oauth_client where client_id=$1 for update", [client.clientId]);
          if (existing.rows.length) {
            const row = existing.rows[0];
            if (!sameValues(row.redirect_uris, [client.redirectUri]) || row.application_type !== "native"
              || row.token_endpoint_auth_method !== "none" || row.require_pkce !== true || row.disabled !== false
              || !sameValues(row.grant_types, ["authorization_code", "refresh_token"])
              || !sameValues(row.response_types, ["code"]) || !sameValues(row.scopes, scopes)) {
              throw new LocalOAuthSetupError({ message: "The client already has different settings; choose a distinct tag client ID" });
            }
          } else {
            await connection.query("insert into auth_oauth_client(client_id,name,application_type,token_endpoint_auth_method,redirect_uris,grant_types,response_types,scopes,require_pkce,skip_consent,enable_end_session,subject_type,disabled,created_at,updated_at) values($1,'cmux local native development','native','none',$2,$3,$4,$5,true,true,true,'public',false,now(),now())",
              [client.clientId, JSON.stringify([client.redirectUri]), JSON.stringify(["authorization_code", "refresh_token"]), JSON.stringify(["code"]), JSON.stringify(scopes)]);
          }
          await connection.query("insert into auth_oauth_resource(identifier,name,access_token_ttl,refresh_token_ttl,signing_algorithm,allowed_scopes,disabled,created_at,updated_at) values($1,'cmux local API',300,2592000,'ES256',$2,false,now(),now()) on conflict(identifier) do nothing",
            [resource, JSON.stringify(scopes)]);
          await connection.query("insert into auth_oauth_client_resource(client_id,resource_id,created_at) values($1,$2,now()) on conflict(client_id,resource_id) do nothing", [client.clientId, resource]);
          await connection.query("insert into auth_oauth_client_resource(client_id,resource_id,created_at) values($1,$2,now()) on conflict(client_id,resource_id) do nothing", [deployment.native.webOAuthClientID, resource]);
          await connection.query("commit");
          return { clientId: client.clientId, resource };
        } catch (error) {
          await connection.query("rollback");
          throw error;
        } finally {
          connection.release();
        }
      } finally {
        await pool.end();
      }
    },
    catch: error => error instanceof LocalOAuthSetupError ? error : new LocalOAuthSetupError({ message: "Local OAuth registration failed; apply the reviewed auth migration first" }),
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  await Effect.runPromise(seedLocalOAuthClient(args.includes("--client-id") ? value("--client-id") : undefined,
    args.includes("--redirect-uri") ? value("--redirect-uri") : undefined).pipe(Effect.match({
      onFailure: error => { console.error(error.message); process.exitCode = 1; },
      onSuccess: result => { console.log(`Registered ${result.clientId} for ${result.resource}`); },
    })));
}
