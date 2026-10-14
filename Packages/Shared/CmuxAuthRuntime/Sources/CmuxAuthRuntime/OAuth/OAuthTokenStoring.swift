/// Persists a complete OAuth session and guards rotation against session replacement.
public protocol OAuthTokenStoring: StackAuthTokenStoreProtocol {
    /// Reads the current session; a locked or failed secure store throws.
    func load() async throws -> OAuthTokenSet?
    /// Persists the complete session; a failed secure write throws.
    func save(_ tokens: OAuthTokenSet) async throws
    /// Grants storage ownership to a newer browser authorization generation.
    /// - Returns: Whether this generation became the current authorization owner.
    func beginAuthorization(generation: UInt64) async -> Bool
    /// Invalidates only this pending authorization, leaving a newer owner's lease intact.
    func invalidateAuthorization(generation: UInt64) async
    /// Rolls back only tokens committed by this authorization, preserving later writes.
    func clearAuthorization(generation: UInt64) async throws -> Bool
    /// Persists credentials atomically only while this authorization still owns storage.
    /// - Returns: Whether the tokens were saved; replaced attempts cannot mutate a newer session.
    func save(_ tokens: OAuthTokenSet, ifAuthorizationGenerationMatches generation: UInt64) async throws -> Bool
    /// Replaces the session only while its refresh token still matches the captured owner.
    /// - Returns: Whether the current session was replaced.
    func replace(_ tokens: OAuthTokenSet?, ifRefreshTokenMatches refreshToken: String) async throws -> Bool
}
