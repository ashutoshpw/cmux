import Foundation

/// The issuer's token response; renewable native grants require a refresh token.
struct OAuthTokenResponse: Decodable {
    let accessToken: String
    let tokenType: String
    let expiresIn: TimeInterval
    let refreshToken: String?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case tokenType = "token_type"
        case expiresIn = "expires_in"
        case refreshToken = "refresh_token"
    }

    func tokens(now: Date, previousRefreshToken: String? = nil) throws -> OAuthTokenSet {
        guard !accessToken.isEmpty, tokenType.lowercased() == "bearer", expiresIn > 0,
              let refresh = refreshToken ?? previousRefreshToken, !refresh.isEmpty else { throw AuthError.serverError(0, "invalid_oauth_token_response") }
        return OAuthTokenSet(accessToken: accessToken, refreshToken: refresh, expiresAt: now.addingTimeInterval(expiresIn))
    }
}
