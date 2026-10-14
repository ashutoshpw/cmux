import { betterAuth } from "better-auth";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import { betterAuthOptions } from "./betterAuthOptions";
import { applicationOrigin } from "../deployment/origin";

export type BetterAuthServer = ReturnType<typeof createBetterAuth>;

export function createBetterAuth(database: Pool, secret: string, origin = applicationOrigin()) {
  return betterAuth({ ...betterAuthOptions(origin), database, secret });
}

let state: { key: string; auth: BetterAuthServer; pool: Pool } | undefined;

/** Lazy construction allows static web builds without contacting or migrating the auth database. */
export function getBetterAuth(): BetterAuthServer {
  const url = process.env.DATABASE_URL?.trim() || process.env.DIRECT_DATABASE_URL?.trim();
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!url) throw new Error("DATABASE_URL is required for Better Auth");
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  const origin = applicationOrigin();
  const key = `${origin}:${url}:${secret}`;
  if (state?.key === key) return state.auth;
  if (state) throw new Error("Better Auth configuration changed in a running process; restart the process");
  const pool = new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 20_000, query_timeout: 10_000 });
  if (process.env.VERCEL === "1") attachDatabasePool(pool);
  pool.on("error", (error: Error) => { console.error("Better Auth database pool failed", { name: error.name }); });
  state = { key, auth: createBetterAuth(pool, secret, origin), pool };
  return state.auth;
}

export async function closeBetterAuthForTests(): Promise<void> {
  const previous = state;
  state = undefined;
  await previous?.pool.end();
}
