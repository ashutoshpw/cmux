import { z } from "zod";
import { readBoundedBody } from "./boundary";
import { identifier, type Identity } from "./contracts/common";
import { OperationError } from "./errors";
export interface StackConfiguration {
  readonly environment: string;
  readonly apiURL: string;
  readonly projectId: string;
  readonly publishableKey?: string;
  readonly serverKey?: string | undefined;
}
export interface VerifiedAuthority {
  readonly environment: string;
  readonly projectId: string;
  readonly teamId: string;
  readonly userId: string;
  readonly verifiedAt: number;
  readonly sessionId: string;
}
const PrincipalSchema = z.object({
  user: z.object({ id: identifier }),
  session: z.object({ id: identifier }),
  organizations: z
    .array(z.object({ id: identifier, role: z.string() }))
    .max(4096),
});
type Fetch = (input: string, init: RequestInit) => Promise<Response>;
/** Transitional name; all authority comes from the owned Better Auth resource API. */
export class StackAuthority {
  private inFlight = 0;
  constructor(
    private readonly configuration: StackConfiguration,
    private readonly request: Fetch = (input, init) => fetch(input, init),
    private readonly maxConcurrent = 8,
  ) {
    const origin = new URL(configuration.apiURL);
    if (
      !["https://cmux.w3dev.app", "https://staging.cmux.w3dev.app"].includes(
        origin.origin,
      ) ||
      origin.href !== `${origin.origin}/`
    )
      throw new Error("Owned authentication origin is required");
    if (configuration.projectId !== origin.origin)
      throw new Error(
        "Authentication project scope must equal the owned origin",
      );
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1)
      throw new Error("Invalid authentication work bound");
  }
  async verify(
    accessToken: string,
    identity: Pick<Identity, "environment" | "projectId" | "teamId" | "userId">,
    now: number,
  ): Promise<VerifiedAuthority> {
    if (!accessToken || accessToken.length > 8192 || /[\r\n]/.test(accessToken))
      throw new OperationError("unauthorized", 401);
    this.assertScope(identity);
    const principal = PrincipalSchema.parse(
      await this.fetch("/api/native-auth/session", {
        method: "GET",
        headers: { authorization: `Bearer ${accessToken}` },
      }),
    );
    if (principal.user.id !== identity.userId)
      throw new OperationError("identity_mismatch", 403);
    if (
      !principal.organizations.some(
        (organization) => organization.id === identity.teamId,
      )
    )
      throw new OperationError("team_access_revoked", 403);
    return { ...identity, verifiedAt: now, sessionId: principal.session.id };
  }
  async canManageTeam(authority: VerifiedAuthority): Promise<boolean> {
    return this.current(authority, authority.userId, "manage");
  }
  async verifyTeamMember(
    teamId: string,
    userId: string,
    authority?: VerifiedAuthority,
  ): Promise<boolean> {
    if (!authority || teamId !== authority.teamId) return false;
    return this.current(authority, userId, "member");
  }
  private assertScope(identity: { environment: string; projectId: string }) {
    if (
      identity.environment !== this.configuration.environment ||
      identity.projectId !== this.configuration.projectId
    )
      throw new OperationError("environment_mismatch", 403);
  }
  private async current(
    authority: VerifiedAuthority,
    userId: string,
    action: "member" | "manage",
  ) {
    this.assertScope(authority);
    if (!authority.sessionId) return false;
    if (!this.configuration.serverKey)
      throw new OperationError("upstream_unavailable", 503, true, 2000);
    const response = await this.fetch(
      "/api/internal/auth-authority",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.configuration.serverKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actorUserId: authority.userId,
          sessionId: authority.sessionId,
          organizationId: authority.teamId,
          userId,
          action,
        }),
      },
      true,
    );
    return z.object({ allowed: z.boolean() }).parse(response).allowed;
  }
  private async fetch(
    path: string,
    input: RequestInit,
    server = false,
  ): Promise<unknown> {
    if (this.inFlight >= this.maxConcurrent)
      throw new OperationError("upstream_unavailable", 503, true, 1000);
    this.inFlight++;
    try {
      const response = await this.request(
        new URL(path, this.configuration.apiURL).href,
        { ...input, signal: AbortSignal.timeout(5000), redirect: "manual" },
      );
      if (!response.ok) {
        await response.body?.cancel();
        if (!server && response.status === 401)
          throw new OperationError("unauthorized", 401);
        if (!server && response.status === 403)
          throw new OperationError("team_access_revoked", 403);
        throw new OperationError("upstream_unavailable", 503, true, 2000);
      }
      return await readBoundedBody(response, 512 * 1024);
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw new OperationError("upstream_unavailable", 503, true, 2000);
    } finally {
      this.inFlight--;
    }
  }
}
