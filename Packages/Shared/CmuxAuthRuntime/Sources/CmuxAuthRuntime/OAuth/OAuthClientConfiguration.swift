public import Foundation

/// Public OAuth client registration resolved at the application composition root.
public struct OAuthClientConfiguration: Equatable, Sendable {
    /// The cmux control-plane origin that issues and accepts these credentials.
    public let origin: URL
    /// A registered public client identifier; native apps never hold a client secret.
    public let clientID: String
    /// The exact registered application callback, including its build-specific scheme.
    public let redirectURI: URL
    /// Scopes authorized for native API access and renewable sessions.
    public let scopes: [String]

    /// Creates a native public client registration.
    /// - Parameters:
    ///   - origin: Issuing cmux origin.
    ///   - clientID: Registered public client identifier.
    ///   - redirectURI: Exact registered callback URL.
    ///   - scopes: OAuth scopes supported by the issuing server.
    public init(origin: URL, clientID: String, redirectURI: URL, scopes: [String] = ["openid", "profile", "email", "offline_access", "cmux:api"]) {
        self.origin = origin
        self.clientID = clientID
        self.redirectURI = redirectURI
        self.scopes = scopes
    }

    /// The resource bound to the native access token's audience.
    public var resource: String { origin.appendingPathComponent("api").absoluteString }
    /// The OAuth authorization endpoint.
    public var authorizationEndpoint: URL { origin.appendingPathComponent("api/auth/oauth2/authorize") }
    /// The OAuth authorization-code and refresh exchange endpoint.
    public var tokenEndpoint: URL { origin.appendingPathComponent("api/auth/oauth2/token") }
    /// The OAuth token revocation endpoint.
    public var revocationEndpoint: URL { origin.appendingPathComponent("api/auth/oauth2/revoke") }
}
