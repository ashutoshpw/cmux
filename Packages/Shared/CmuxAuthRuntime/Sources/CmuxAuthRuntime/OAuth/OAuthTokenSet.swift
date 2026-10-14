public import Foundation

/// A renewable OAuth session stored together so token rotation is atomic.
public struct OAuthTokenSet: Codable, Equatable, Sendable {
    /// The API bearer credential.
    public let accessToken: String
    /// The credential used only at the issuer's token and revocation endpoints.
    public let refreshToken: String
    /// The issuer-reported access-token expiry.
    public let expiresAt: Date

    /// Creates a session from an OAuth token response.
    /// - Parameters:
    ///   - accessToken: Nonempty bearer token.
    ///   - refreshToken: Nonempty renewable-session token.
    ///   - expiresAt: Absolute access-token expiration.
    public init(accessToken: String, refreshToken: String, expiresAt: Date) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
    }
}
