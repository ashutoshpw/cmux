public import CMUXAuthCore
public import Foundation

/// Native public OAuth client backed by the fork's Better Auth issuer.
///
/// The coordinator remains the session-state owner. This actor exchanges codes,
/// refreshes credentials, and maps authoritative organizations to cmux teams.
public actor BetterAuthClient: AuthClient {
    private let configuration: OAuthClientConfiguration
    private let store: any OAuthTokenStoring
    private let transport: any OAuthHTTPTransport
    private let browser: OAuthAuthorizationFlow
    private let now: @Sendable () -> Date
    private var revision: UInt64 = 0
    private var authorizationGeneration: UInt64?
    private var sessionWriteRevision: UInt64 = 0
    private var refreshWork: (id: UUID, token: String, task: Task<OAuthTokenSet?, any Error>)?

    /// Creates a client with secure storage and the shared browser exchange.
    /// - Parameters:
    ///   - configuration: Exact registered public OAuth client configuration.
    ///   - store: Secure session storage, scoped to the installation and issuer.
    ///   - transport: Issuer/API HTTP transport that refuses redirects.
    ///   - browser: System-browser PKCE flow shared with host sign-in entrypoints.
    ///   - now: Clock used to decide when access tokens need renewal.
    public init(configuration: OAuthClientConfiguration, store: any OAuthTokenStoring, transport: any OAuthHTTPTransport, browser: OAuthAuthorizationFlow, now: @escaping @Sendable () -> Date = { Date() }) {
        self.configuration = configuration
        self.store = store
        self.transport = transport
        self.browser = browser
        self.now = now
    }

    public func accessToken() async -> String? { try? await resolvedAccessToken(forceRefresh: false) }
    public func refreshToken() async -> String? { try? await store.load()?.refreshToken }
    public func storedAccessToken() async -> String? { try? await store.load()?.accessToken }
    public func forceRefreshAccessToken() async -> String? { try? await resolvedAccessToken(forceRefresh: true) }

    public func resolvedAccessToken(forceRefresh: Bool) async throws -> String? {
        let expectedRevision = revision
        let tokens = try await store.load()
        guard expectedRevision == revision else { throw CancellationError() }
        guard let tokens else { return nil }
        if !forceRefresh, tokens.expiresAt.timeIntervalSince(now()) > 60 { return tokens.accessToken }
        let work: (id: UUID, token: String, task: Task<OAuthTokenSet?, any Error>)
        if let existing = refreshWork, existing.token == tokens.refreshToken { work = existing }
        else {
            let id = UUID()
            let task = Task { try await self.refresh(tokens, expectedRevision: expectedRevision) }
            work = (id, tokens.refreshToken, task)
            refreshWork = work
        }
        defer { if refreshWork?.id == work.id { refreshWork = nil } }
        let refreshed = try await work.task.value
        try Task.checkCancellation()
        guard expectedRevision == revision else { throw CancellationError() }
        return refreshed?.accessToken
    }

    private func refresh(_ tokens: OAuthTokenSet, expectedRevision: UInt64) async throws -> OAuthTokenSet? {
        let request = OAuthFormRequest(url: configuration.tokenEndpoint, parameters: [
            ("grant_type", "refresh_token"), ("client_id", configuration.clientID),
            ("refresh_token", tokens.refreshToken), ("resource", configuration.resource)
        ]).request
        let (data, response) = try await transport.send(request)
        try Task.checkCancellation()
        guard expectedRevision == revision else { throw CancellationError() }
        if response.statusCode == 400,
           (try? JSONDecoder().decode(OAuthFailure.self, from: data).error) == "invalid_grant" {
            _ = try await store.replace(nil, ifRefreshTokenMatches: tokens.refreshToken)
            return nil
        }
        guard (200..<300).contains(response.statusCode) else { throw AuthError.networkError }
        let refreshed = try JSONDecoder().decode(OAuthTokenResponse.self, from: data).tokens(now: now(), previousRefreshToken: tokens.refreshToken)
        guard try await store.replace(refreshed, ifRefreshTokenMatches: tokens.refreshToken) else { throw CancellationError() }
        guard expectedRevision == revision else {
            _ = try await store.replace(nil, ifRefreshTokenMatches: refreshed.refreshToken)
            throw CancellationError()
        }
        return refreshed
    }

    /// Invalidates earlier exchanges before the host issues a replacement browser attempt.
    /// - Throws: Cancellation if another authorization or sign-out supersedes preparation.
    public func prepareBrowserSignIn() async throws -> UInt64? {
        try await beginAuthorization()
    }

    public func cancelBrowserSignIn(attemptGeneration generation: UInt64) async {
        guard authorizationGeneration == generation, revision == generation else { return }
        authorizationGeneration = nil
        revision &+= 1
        refreshWork?.task.cancel()
        refreshWork = nil
        await store.invalidateAuthorization(generation: generation)
    }

    private func beginAuthorization() async throws -> UInt64 {
        try Task.checkCancellation()
        revision &+= 1
        let generation = revision
        refreshWork?.task.cancel()
        refreshWork = nil
        do {
            guard await store.beginAuthorization(generation: generation), generation == revision else {
                throw CancellationError()
            }
            try Task.checkCancellation()
        } catch {
            if generation == revision {
                authorizationGeneration = nil
                revision &+= 1
            }
            await store.invalidateAuthorization(generation: generation)
            throw error
        }
        authorizationGeneration = generation
        return generation
    }

    /// Exchanges a hosted callback and persists its tokens before coordinator validation.
    /// - Parameter url: Exact registered callback with code and state.
    /// - Returns: The persisted token pair for the host flow's race guards.
    /// - Throws: Callback validation, secure-storage or transport failure.
    public func completeBrowserCallback(_ url: URL) async throws -> AuthCallbackPayload {
        let generation = try await beginAuthorization()
        return try await completeBrowserCallback(url, attemptGeneration: generation)
    }

    /// Exchanges only the callback bound to the host's captured authorization receipt.
    public func completeBrowserCallback(_ url: URL, attemptGeneration: UInt64?) async throws -> AuthCallbackPayload {
        try Task.checkCancellation()
        guard let expectedRevision = attemptGeneration,
              authorizationGeneration == expectedRevision, revision == expectedRevision else {
            throw CancellationError()
        }
        return try await withTaskCancellationHandler {
            let tokens = try await browser.exchangeCallback(url)
            try await persist(tokens, expectedRevision: expectedRevision)
            return AuthCallbackPayload(refreshToken: tokens.refreshToken, accessToken: tokens.accessToken,
                                       authorizationGeneration: expectedRevision)
        } onCancel: {
            Task { await self.cancelBrowserSignIn(attemptGeneration: expectedRevision) }
        }
    }

    public func signInWithOAuth(provider: String, anchor: any AuthPresentationAnchoring) async throws {
        let generation = try await beginAuthorization()
        try await signInWithOAuth(provider: provider, anchor: anchor, attemptGeneration: generation)
    }

    public func signInWithOAuth(provider: String, anchor: any AuthPresentationAnchoring, attemptGeneration: UInt64?) async throws {
        try Task.checkCancellation()
        guard let expectedRevision = attemptGeneration,
              authorizationGeneration == expectedRevision, revision == expectedRevision else {
            throw CancellationError()
        }
        try await withTaskCancellationHandler {
            let tokens = try await browser.signIn(anchor: anchor, provider: provider.isEmpty ? nil : provider)
            try await persist(tokens, expectedRevision: expectedRevision)
        } onCancel: {
            Task { await self.cancelBrowserSignIn(attemptGeneration: expectedRevision) }
        }
    }

    private func persist(_ tokens: OAuthTokenSet, expectedRevision: UInt64) async throws {
        try Task.checkCancellation()
        guard expectedRevision == revision else { throw CancellationError() }
        guard try await store.save(tokens, ifAuthorizationGenerationMatches: expectedRevision) else {
            throw CancellationError()
        }
        guard expectedRevision == revision, !Task.isCancelled else {
            _ = try await store.clearAuthorization(generation: expectedRevision)
            throw CancellationError()
        }
        sessionWriteRevision &+= 1
        if authorizationGeneration == expectedRevision { authorizationGeneration = nil }
    }

    public func currentUser(throwOnMissing: Bool) async throws -> CMUXAuthUser? {
        guard try await resolvedAccessToken(forceRefresh: false) != nil else {
            if throwOnMissing { throw AuthError.unauthorized }
            return nil
        }
        return try await session().user.summary
    }
    public func listTeams() async throws -> [CMUXAuthTeam] { try await session().organizations.map(\.team) }
    public func selectedTeamID() async throws -> String? { try await session().activeOrganizationId }
    public func setSelectedTeam(id: String?) async throws {
        let body = try JSONEncoder().encode(OrganizationSelection(organizationId: id))
        _ = try await api(path: "api/native-auth/organization", method: "POST", body: body)
    }
    public func createTeam(displayName: String) async throws -> CMUXAuthTeam {
        let name = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw AuthClientError.invalidTeamName }
        let data = try await api(path: "api/subrouter/teams", method: "POST", body: JSONEncoder().encode(TeamCreation(displayName: name)))
        let result = try JSONDecoder().decode(CreatedTeam.self, from: data)
        return CMUXAuthTeam(id: result.team.id, displayName: result.team.name)
    }
    private func session() async throws -> NativeAuthSession {
        try JSONDecoder().decode(NativeAuthSession.self, from: await api(path: "api/native-auth/session"))
    }
    private func api(path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        let expectedRevision = revision
        guard let token = try await resolvedAccessToken(forceRefresh: false) else { throw AuthError.unauthorized }
        guard expectedRevision == revision else { throw CancellationError() }
        var request = URLRequest(url: configuration.origin.appendingPathComponent(path))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        var (data, response) = try await transport.send(request)
        if response.statusCode == 401, let renewed = try await resolvedAccessToken(forceRefresh: true) {
            request.setValue("Bearer \(renewed)", forHTTPHeaderField: "Authorization")
            (data, response) = try await transport.send(request)
        }
        try Task.checkCancellation()
        guard expectedRevision == revision else { throw CancellationError() }
        guard (200..<300).contains(response.statusCode) else {
            if response.statusCode == 401 { throw AuthError.unauthorized }
            if response.statusCode == 429 { throw AuthError.rateLimited }
            throw AuthError.serverError(response.statusCode, "native_auth_request_failed")
        }
        return data
    }

    public func clearLocalSession() async {
        revision &+= 1
        authorizationGeneration = nil
        refreshWork?.task.cancel()
        refreshWork = nil
        await browser.cancel()
        await store.clear()
    }
    public func clearLocalSession(ifRefreshTokenMatches refreshToken: String) async {
        let expectedRevision = revision
        let expectedWriteRevision = sessionWriteRevision
        if (try? await store.replace(nil, ifRefreshTokenMatches: refreshToken)) == true {
            // A conditional cleanup may have cleared an older session while a
            // newer browser attempt owns storage or has just published tokens.
            guard expectedRevision == revision,
                  expectedWriteRevision == sessionWriteRevision,
                  authorizationGeneration == nil else { return }
            revision &+= 1
            refreshWork?.task.cancel()
            refreshWork = nil
        }
    }
    public func revokeSession(accessToken: String?, refreshToken: String?) async throws {
        // The server invalidates the browser session and every owned OAuth grant.
        // Local credentials have already been cleared and are never re-seeded.
        if let accessToken {
            var request = URLRequest(url: configuration.origin.appendingPathComponent("api/native-auth/sign-out"))
            request.httpMethod = "POST"
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
            let (_, response) = try await transport.send(request)
            guard (200..<300).contains(response.statusCode) || response.statusCode == 401 else { throw AuthError.networkError }
        }
        if let refreshToken {
            let request = OAuthFormRequest(url: configuration.revocationEndpoint, parameters: [("client_id", configuration.clientID), ("token", refreshToken), ("token_type_hint", "refresh_token")]).request
            let (_, response) = try await transport.send(request)
            guard (200..<300).contains(response.statusCode) else { throw AuthError.networkError }
        }
    }
    public func freshAccessToken(accessToken: String?, refreshToken: String) async -> String? {
        if let accessToken, let lifetime = AccessTokenLifetime(accessToken), lifetime.expiresInSeconds > 30 { return accessToken }
        let request = OAuthFormRequest(url: configuration.tokenEndpoint, parameters: [("grant_type", "refresh_token"), ("client_id", configuration.clientID), ("refresh_token", refreshToken), ("resource", configuration.resource)]).request
        guard let (data, response) = try? await transport.send(request), (200..<300).contains(response.statusCode),
              let tokens = try? JSONDecoder().decode(OAuthTokenResponse.self, from: data).tokens(now: now(), previousRefreshToken: refreshToken) else { return nil }
        return tokens.accessToken
    }

    // Public clients authenticate in the browser; credential/OTP grants are not enabled.
    public func sendMagicLinkEmail(email: String, callbackURL: String) async throws -> String { throw AuthClientError.unsupported }
    public func signInWithMagicLink(code: String) async throws { throw AuthClientError.unsupported }
    public func signInWithCredential(email: String, password: String) async throws { throw AuthClientError.unsupported }

    private struct OAuthFailure: Decodable { let error: String }
    private struct OrganizationSelection: Encodable {
        let organizationId: String?
        enum CodingKeys: String, CodingKey { case organizationId }
        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            if let organizationId { try container.encode(organizationId, forKey: .organizationId) }
            else { try container.encodeNil(forKey: .organizationId) }
        }
    }
    private struct TeamCreation: Encodable { let displayName: String }
    private struct CreatedTeam: Decodable {
        let team: Team
        struct Team: Decodable { let id: String; let name: String }
    }
}
