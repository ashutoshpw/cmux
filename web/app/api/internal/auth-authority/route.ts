import { timingSafeEqual, createHash } from "node:crypto";
import { Effect, Exit } from "effect";
import { z } from "zod";
import { readBetterAuthAuthority } from "../../../../services/auth/betterAuthAuthority";
const inputSchema = z
  .object({
    actorUserId: z.uuid(),
    sessionId: z.uuid(),
    organizationId: z.uuid(),
    userId: z.uuid(),
    action: z.enum(["member", "manage"]),
  })
  .strict();
function reply(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
function authorized(request: Request): boolean {
  const secret = process.env.CMUX_AUTH_SERVICE_KEY?.trim();
  const candidate = request.headers
    .get("authorization")
    ?.replace(/^Bearer /u, "");
  if (!secret || secret.length < 32 || !candidate) return false;
  return timingSafeEqual(
    createHash("sha256").update(secret).digest(),
    createHash("sha256").update(candidate).digest(),
  );
}
export async function POST(request: Request): Promise<Response> {
  if (!authorized(request)) return reply({ error: "unauthorized" }, 401);
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return reply({ error: "invalid_request" }, 400);
  const result = await Effect.runPromiseExit(
    readBetterAuthAuthority(input.data),
  );
  return Exit.isSuccess(result)
    ? reply({ allowed: result.value })
    : reply({ error: "authentication_authority_unavailable" }, 503);
}
