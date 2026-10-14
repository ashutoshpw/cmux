/** Historical mirror types retained for data cleanup; the provider transport is retired. */
export type HexclaveServerUser = {
 id: string; primary_email: string | null; display_name: string | null; is_anonymous: boolean;
 client_read_only_metadata: Record<string, unknown> | null; signed_up_at_millis: number;
 [key: string]: unknown;
};
export type HexclaveServerTeam = { id: string; display_name: string; client_read_only_metadata: Record<string, unknown> | null; created_at_millis: number; [key: string]: unknown };
export type HexclaveTeamPermission = { id: string; team_id: string; user_id: string };
export type HexclaveProjectPermission = { id: string; user_id: string };
export type HexclavePage<T> = { readonly items: readonly T[]; readonly nextCursor: string | null };

export type HexclaveSource = {
  readonly getUser: (userId: string) => Promise<HexclaveServerUser | null>;
  readonly getTeam: (teamId: string) => Promise<HexclaveServerTeam | null>;
  /** Every team the user is a direct member of (Hexclave returns the full list unpaged). */
  readonly listUserTeams: (userId: string) => Promise<readonly HexclaveServerTeam[]>;
  /** Direct (non-recursive) team permissions of the user across all teams. */
  readonly listUserTeamPermissions: (userId: string) => Promise<readonly HexclaveTeamPermission[]>;
  /** Direct (non-recursive) project permissions of the user. */
  readonly listUserProjectPermissions: (userId: string) => Promise<readonly HexclaveProjectPermission[]>;
  readonly listUsersPage: (cursor: string | null, limit: number) => Promise<HexclavePage<HexclaveServerUser>>;
  readonly listTeamsPage: (cursor: string | null, limit: number) => Promise<HexclavePage<HexclaveServerTeam>>;
  /** One page of a team's direct members (all users, anonymous included). */
  readonly listTeamMembersPage: (
    teamId: string,
    cursor: string | null,
    limit: number,
  ) => Promise<HexclavePage<HexclaveServerUser>>;
  /** Every direct team permission in the project, in one unpaged call. */
  readonly listAllTeamPermissions: () => Promise<readonly HexclaveTeamPermission[]>;
  /** Every direct project permission in the project, in one unpaged call. */
  readonly listAllProjectPermissions: () => Promise<readonly HexclaveProjectPermission[]>;
};

export class HexclaveApiError extends Error {
 constructor(message: string, readonly details: { status?: number; knownError?: string | null; errors?: readonly string[]; retryAfterSeconds?: number } = {}) { super(message); this.name = "HexclaveApiError"; }
}
export type HexclaveServerApiConfig = { projectId: string; secretServerKey: string; baseURL?: string; fetch?: typeof fetch; timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<void> };
export function hexclaveRetryDelayMs(response: Response, attempt: number): number { const retryAfter = Number(response.headers.get("retry-after")); return retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : Math.min(500 * 2 ** attempt, 30000); }
export function createHexclaveServerApi(_config: HexclaveServerApiConfig): HexclaveSource { throw new Error("Legacy auth provider transport is retired; use owned Better Auth APIs"); }
