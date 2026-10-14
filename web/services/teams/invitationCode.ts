import { memberLimitForTeam } from "./seats";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { cloudDb } from "../../db/client";
import {
  betterAuthInvitation,
  betterAuthMember,
  betterAuthOrganization,
} from "../../db/betterAuthSchema";
import { resolveBetterAuthPrincipal } from "../auth/betterAuthPrincipal";
import { canonicalizeEmailForMatching } from "../billing/emailMatching";
import { assertOrganizationMembershipAdmission } from "./organizationAdministration";
import { withTeamAdminLock } from "./repository";
import { TeamApiError } from "./errors";
export type InvitationCodeFailure =
  "email_mismatch" | "invalid" | "unavailable" | "seat_limit";
export type InvitationCodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: InvitationCodeFailure };
export type InvitationCodeClient = {
  details(
    code: string,
    accessToken: string,
  ): Promise<InvitationCodeResult<{ teamId: string; teamDisplayName: string }>>;
  accept(
    code: string,
    accessToken: string,
  ): Promise<InvitationCodeResult<null>>;
};
/** Standard organization invitation IDs are verified against the current owned principal. */
export function createInvitationCodeClient(
  _options: {
    environment?: Record<string, string | undefined>;
    fetch?: (input: string, init: RequestInit) => Promise<Response>;
  } = {},
): InvitationCodeClient {
  void _options;
  async function read(code: string, token: string) {
    if (!/^[0-9a-f-]{36}$/iu.test(code)) return null;
    const principal = await resolveBetterAuthPrincipal(
      new Headers({ authorization: `Bearer ${token}` }),
    );
    if (!principal || !principal.emailVerified || principal.isAnonymous)
      return null;
    const [invitation] = await cloudDb()
      .select({
        invitation: betterAuthInvitation,
        name: betterAuthOrganization.name,
      })
      .from(betterAuthInvitation)
      .innerJoin(
        betterAuthOrganization,
        eq(betterAuthOrganization.id, betterAuthInvitation.organizationId),
      )
      .where(eq(betterAuthInvitation.id, code))
      .limit(1);
    if (
      !invitation ||
      invitation.invitation.status !== "pending" ||
      invitation.invitation.expiresAt <= new Date()
    )
      return null;
    return { ...invitation, principal };
  }
  return {
    async details(code, token) {
      try {
        const result = await read(code, token);
        if (!result) return { ok: false, failure: "invalid" };
        if (
          canonicalizeEmailForMatching(result.invitation.email) !==
          canonicalizeEmailForMatching(result.principal.email)
        )
          return { ok: false, failure: "email_mismatch" };
        return {
          ok: true,
          value: {
            teamId: result.invitation.organizationId,
            teamDisplayName: result.name,
          },
        };
      } catch (error) {
        return { ok: false, failure: error instanceof InvitationSeatLimitError ? "seat_limit" : "unavailable" };
      }
    },
    async accept(code, token) {
      try {
        const result = await read(code, token);
        if (!result) return { ok: false, failure: "invalid" };
        if (
          canonicalizeEmailForMatching(result.invitation.email) !==
          canonicalizeEmailForMatching(result.principal.email)
        )
          return { ok: false, failure: "email_mismatch" };
        const accepted = await withTeamAdminLock(result.invitation.organizationId, async (tx) => {
          const [invitation] = await tx
            .select()
            .from(betterAuthInvitation)
            .where(
              and(
                eq(betterAuthInvitation.id, code),
                eq(betterAuthInvitation.status, "pending"),
              ),
            )
            .for("update");
          if (!invitation || invitation.expiresAt <= new Date()) return false;
          const [organization] = await tx.select({ clientReadOnlyMetadata: betterAuthOrganization.clientReadOnlyMetadata }).from(betterAuthOrganization).where(eq(betterAuthOrganization.id, invitation.organizationId)).limit(1);
          if (!organization) return false;
          await assertOrganizationMembershipAdmission(tx, invitation.organizationId, result.principal.userId);
          const roster = await tx.select({ userId: betterAuthMember.userId }).from(betterAuthMember).where(eq(betterAuthMember.organizationId, invitation.organizationId));
          const limit = memberLimitForTeam(organization);
          if (!roster.some(member => member.userId === result.principal.userId) && limit !== null && roster.length >= limit) throw new InvitationSeatLimitError();
          const role = invitation.role === "admin" ? "admin" : "member";
          await tx
            .insert(betterAuthMember)
            .values({
              id: randomUUID(),
              organizationId: invitation.organizationId,
              userId: result.principal.userId,
              role,
              createdAt: new Date(),
            })
            .onConflictDoNothing();
          await tx
            .update(betterAuthInvitation)
            .set({ status: "accepted" })
            .where(eq(betterAuthInvitation.id, code));
          return true;
        });
        return accepted
          ? { ok: true, value: null }
          : { ok: false, failure: "invalid" };
      } catch (error) {
        if (error instanceof TeamApiError && error.code === "team_not_found") return { ok: false, failure: "invalid" };
        return { ok: false, failure: error instanceof InvitationSeatLimitError ? "seat_limit" : "unavailable" };
      }
    },
  };
}

class InvitationSeatLimitError extends Error {}
