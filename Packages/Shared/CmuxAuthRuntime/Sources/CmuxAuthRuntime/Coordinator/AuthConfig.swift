public import CMUXAuthCore
import Foundation

/// The fully resolved auth configuration handed to the runtime at startup.
///
/// Consolidates the OAuth authority/client identity (through ``CMUXAuthConfig``) with the
/// magic-link callback URL and the cmux web API base URL, so both apps build
/// native auth client and push registration service from one value instead of
/// the per-app `AppEnvironment` / `AuthEnvironment` tables. Resolve it once at
/// the composition root via ``init(environment:overrides:)`` (injecting the
/// `LocalConfig.plist` overrides) and inject it down; the type never reads
/// `Bundle.main` itself.
public struct AuthConfig: Equatable, Sendable {
    /// Compatibility fields carrying the application authority and public OAuth client ID.
    public let stack: CMUXAuthConfig
    /// The auth callback URL the magic-link email should target.
    public let magicLinkCallbackURL: String
    /// The base URL of the cmux web API (device-token registration, push).
    public let apiBaseURL: String

    /// Creates an auth configuration from its resolved parts.
    public init(stack: CMUXAuthConfig, magicLinkCallbackURL: String, apiBaseURL: String) {
        self.stack = stack
        self.magicLinkCallbackURL = magicLinkCallbackURL
        self.apiBaseURL = apiBaseURL
    }

    /// Resolve the configuration for an environment, applying `LocalConfig.plist`
    /// string overrides supplied by the caller.
    ///
    /// - Parameters:
    ///   - environment: The build environment (development for DEBUG, production
    ///     otherwise). Decided by the composition root, not read here.
    ///   - overrides: String overrides (e.g. parsed from a bundled
    ///     `LocalConfig.plist`). Recognized keys: `OAuthClientID` and `ApiBaseURL`.
    public init(
        environment: CMUXAuthEnvironment,
        overrides: [String: String] = [:]
    ) {

        let callbackURL: String
        let defaultAPIBaseURL: String
        switch environment {
        case .development:
            callbackURL = "http://localhost:3000/auth/callback"
            defaultAPIBaseURL = "http://localhost:3000"
        case .production:
            callbackURL = ForkDeployment.productionOrigin + "/auth/callback"
            defaultAPIBaseURL = ForkDeployment.productionOrigin
        }

        let override = overrides["ApiBaseURL"]
        let apiBaseURL: String
        if let override, !override.isEmpty {
            apiBaseURL = override.hasSuffix("/") ? String(override.dropLast()) : override
        } else {
            apiBaseURL = defaultAPIBaseURL
        }
        self.init(
            stack: CMUXAuthConfig(projectId: apiBaseURL, publishableClientKey: overrides["OAuthClientID"] ?? ForkDeployment.iOSOAuthClientID),
            magicLinkCallbackURL: callbackURL,
            apiBaseURL: apiBaseURL
        )
    }
}
