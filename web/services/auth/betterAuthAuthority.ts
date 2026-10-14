import { Effect, Data } from "effect";
import { and, eq, gt } from "drizzle-orm";
import { cloudDb } from "../../db/client";
import {
  betterAuthMember,
  betterAuthSession,
  betterAuthUser,
} from "../../db/betterAuthSchema";
import { hasBlockingAccountDeletionIdentity } from "../account/deletionLock";
export type AuthAuthorityInput = {
  actorUserId: string;
  sessionId: string;
  organizationId: string;
  userId: string;
  action: "member" | "manage";
};
export class AuthAuthorityUnavailable extends Data.TaggedError(
  "AuthAuthorityUnavailable",
)<{ message: string }> {}
/** Only a live verified session and current organization actor can resolve scoped ticket authority. */
export function readBetterAuthAuthority(input: AuthAuthorityInput) {
  return Effect.tryPromise({
    try: async () => {
      const db = cloudDb();
      const [session] = await db
        .select({
          id: betterAuthSession.id,
          verified: betterAuthUser.emailVerified,
          anonymous: betterAuthUser.isAnonymous,
        })
        .from(betterAuthSession)
        .innerJoin(
          betterAuthUser,
          eq(betterAuthUser.id, betterAuthSession.userId),
        )
        .where(
          and(
            eq(betterAuthSession.id, input.sessionId),
            eq(betterAuthSession.userId, input.actorUserId),
            gt(betterAuthSession.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (
        !session ||
        !session.verified ||
        session.anonymous ||
        (await hasBlockingAccountDeletionIdentity(db, [
          input.actorUserId,
          input.userId,
        ]))
      )
        return false;
      const [actor] = await db
        .select({ role: betterAuthMember.role })
        .from(betterAuthMember)
        .where(
          and(
            eq(betterAuthMember.userId, input.actorUserId),
            eq(betterAuthMember.organizationId, input.organizationId),
          ),
        )
        .limit(1);
      if (!actor) return false;
      const [member] = await db
        .select({ role: betterAuthMember.role })
        .from(betterAuthMember)
        .where(
          and(
            eq(betterAuthMember.userId, input.userId),
            eq(betterAuthMember.organizationId, input.organizationId),
          ),
        )
        .limit(1);
      return (
        !!member &&
        (input.action === "member" ||
          (input.userId === input.actorUserId &&
            actor.role
              .split(",")
              .some((role) => role === "owner" || role === "admin")))
      );
    },
    catch: () =>
      new AuthAuthorityUnavailable({
        message: "Current authentication authority is unavailable",
      }),
  });
}
