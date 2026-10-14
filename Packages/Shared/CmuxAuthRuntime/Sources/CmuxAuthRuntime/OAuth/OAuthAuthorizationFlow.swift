public import Foundation

/// Owns single-use browser authorization attempts and PKCE code exchanges.
@MainActor
public final class OAuthAuthorizationFlow {
    private struct Attempt {
        let proof: OAuthPKCEChallenge
        let createdAt: Date
    }
    private let configuration: OAuthClientConfiguration
    private let transport: any OAuthHTTPTransport
    private let now: @Sendable () -> Date
    private let ephemeralSession: Bool
    private var attempts: [String: Attempt] = [:]
    private var activeBrowserState: String?
    private var activeSession: (any HostBrowserAuthSession)?
    private var activeContinuation: CheckedContinuation<URL, any Error>?

    /// Creates a browser flow for one registered native client.
    /// - Parameters:
    ///   - configuration: The exact native client registration.
    ///   - transport: Credential-preserving HTTP boundary.
    ///   - ephemeralSession: Prevents reusing another installed build's browser cookies.
    ///   - now: The clock used to expire abandoned authorization attempts.
    public init(configuration: OAuthClientConfiguration, transport: any OAuthHTTPTransport, ephemeralSession: Bool = false, now: @escaping @Sendable () -> Date = { Date() }) {
        self.configuration = configuration
        self.transport = transport
        self.ephemeralSession = ephemeralSession
        self.now = now
    }

    /// Builds the same authorization request for a popup and its browser fallback.
    /// - Parameters:
    ///   - state: Unguessable correlation value owned by the invoking UI flow.
    ///   - provider: Optional hosted sign-in hint; authorization still uses PKCE.
    /// - Returns: The issuer's authorization URL, containing no native tokens.
    public func authorizationURL(state: String, provider: String? = nil) -> URL {
        attempts = attempts.filter { now().timeIntervalSince($0.value.createdAt) < 600 }
        let attempt = attempts[state] ?? Attempt(proof: OAuthPKCEChallenge(), createdAt: now())
        attempts[state] = attempt
        var components = URLComponents(url: configuration.authorizationEndpoint, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: configuration.clientID),
            URLQueryItem(name: "redirect_uri", value: configuration.redirectURI.absoluteString),
            URLQueryItem(name: "scope", value: configuration.scopes.joined(separator: " ")),
            URLQueryItem(name: "resource", value: configuration.resource),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "code_challenge", value: attempt.proof.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256")
        ]
        if let provider, !provider.isEmpty { components.queryItems?.append(URLQueryItem(name: "login_hint", value: provider)) }
        return components.url!
    }

    /// Validates and consumes one exact callback, then exchanges its code.
    /// - Parameter url: The browser's callback URL.
    /// - Returns: The token response obtained directly from the issuer.
    /// - Throws: Invalid state, expired/replayed callback, OAuth or transport failure.
    public func exchangeCallback(_ url: URL) async throws -> OAuthTokenSet {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == configuration.redirectURI.scheme?.lowercased(),
              components.host == configuration.redirectURI.host,
              components.path == configuration.redirectURI.path,
              components.port == configuration.redirectURI.port,
              components.user == nil, components.password == nil, components.fragment == nil,
              let items = components.queryItems,
              items.filter({ $0.name == "state" }).count == 1,
              let state = items.first(where: { $0.name == "state" })?.value,
              let attempt = attempts[state], now().timeIntervalSince(attempt.createdAt) < 600,
              !items.contains(where: { ["access_token", "refresh_token", "stack_access", "stack_refresh"].contains($0.name) }) else { throw AuthError.invalidCallback }
        // Consume before suspension: duplicate callback delivery cannot replay an exchange.
        attempts[state] = nil
        if let error = items.first(where: { $0.name == "error" })?.value {
            if ["invalid_client", "unauthorized_client", "invalid_redirect_uri"].contains(error) {
                throw AuthError.serverError(400, "oauth_client_not_registered")
            }
            throw AuthError.authFailure
        }
        guard items.filter({ $0.name == "code" }).count == 1,
              let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else { throw AuthError.invalidCallback }
        try Task.checkCancellation()
        let request = OAuthFormRequest(url: configuration.tokenEndpoint, parameters: [
            ("grant_type", "authorization_code"), ("client_id", configuration.clientID),
            ("redirect_uri", configuration.redirectURI.absoluteString), ("code", code),
            ("code_verifier", attempt.proof.verifier), ("resource", configuration.resource)
        ]).request
        let (data, response) = try await transport.send(request)
        try Task.checkCancellation()
        guard (200..<300).contains(response.statusCode) else {
            let body = try? JSONSerialization.jsonObject(with: data) as? [String: String]
            let reason = ["invalid_client", "unauthorized_client"].contains(body?["error"] ?? "")
                ? "oauth_client_not_registered" : "oauth_exchange_failed"
            throw AuthError.serverError(response.statusCode, reason)
        }
        return try JSONDecoder().decode(OAuthTokenResponse.self, from: data).tokens(now: now())
    }

    /// Presents the system browser and exchanges its callback.
    /// - Parameters:
    ///   - anchor: Platform presentation anchor.
    ///   - provider: Optional hosted sign-in hint.
    /// - Returns: The issuer's token response.
    /// - Throws: Cancellation or a validated exchange failure.
    public func signIn(anchor: any AuthPresentationAnchoring, provider: String? = nil) async throws -> OAuthTokenSet {
        cancel()
        let state = UUID().uuidString + UUID().uuidString
        let url = authorizationURL(state: state, provider: provider)
        let callback: URL
        do {
            callback = try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    activeContinuation = continuation
                    activeBrowserState = state
                    let factory = ASWebBrowserAuthSessionFactory(anchor: anchor, ephemeralSession: ephemeralSession)
                    let session = factory.makeSession(signInURL: url, callbackScheme: configuration.redirectURI.scheme!) { [weak self] result in
                        guard let self, self.activeBrowserState == state else { return }
                        self.activeBrowserState = nil
                        self.activeSession = nil
                        let continuation = self.activeContinuation
                        self.activeContinuation = nil
                        switch result {
                        case .callback(let callback): continuation?.resume(returning: callback)
                        case .cancelled: continuation?.resume(throwing: AuthError.cancelled)
                        case .failed: continuation?.resume(throwing: AuthError.browserSignInFailed("oauth_browser_failed"))
                        }
                    }
                    activeSession = session
                    if !session.start() {
                        activeContinuation = nil
                        activeBrowserState = nil
                        activeSession = nil
                        continuation.resume(throwing: AuthError.browserSignInFailed("oauth_browser_unavailable"))
                    }
                }
            } onCancel: {
                Task { @MainActor [weak self] in
                    guard self?.activeBrowserState == state else { return }
                    self?.cancel()
                }
            }
            try Task.checkCancellation()
            return try await exchangeCallback(callback)
        } catch {
            attempts[state] = nil
            throw error
        }
    }

    /// Invalidates pending callbacks and closes this flow's browser session.
    public func cancel() {
        attempts.removeAll()
        activeBrowserState = nil
        let continuation = activeContinuation
        activeContinuation = nil
        let session = activeSession
        activeSession = nil
        session?.cancel()
        continuation?.resume(throwing: AuthError.cancelled)
    }
}
