import CMUXAuthCore
import Foundation
import Testing
@testable import CmuxAuthRuntime

@Suite("Fork native OAuth public-client protocol")
@MainActor
struct OAuthProtocolTests {
    private let origin = URL(string: "https://issuer.example")!
    private let redirect = URL(string: "cmux-w3dev://auth-callback")!

    @Test("RFC 7636 S256 vector")
    func proofKeyUsesRFCVector() throws {
        let proof = try OAuthPKCEChallenge(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        #expect(proof.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test("Code exchange binds exact client callback and resource; callback is single-use")
    func exchangesCodeAndRejectsReplay() async throws {
        let transport = OAuthRecordingTransport()
        let configuration = OAuthClientConfiguration(origin: origin, clientID: "public-mac", redirectURI: redirect)
        let flow = OAuthAuthorizationFlow(configuration: configuration, transport: transport)
        let authorization = flow.authorizationURL(state: "issued-state")
        let query = try #require(URLComponents(url: authorization, resolvingAgainstBaseURL: false)?.queryItems)
        #expect(query.first { $0.name == "resource" }?.value == "https://issuer.example/api")
        #expect(query.first { $0.name == "code_challenge_method" }?.value == "S256")
        #expect(!query.contains { ["refresh_token", "access_token", "code_verifier"].contains($0.name) })
        let fallback = flow.authorizationURL(state: "issued-state")
        #expect(fallback == authorization)

        let callback = URL(string: "cmux-w3dev://auth-callback?code=short-lived-code&state=issued-state")!
        let tokens = try await flow.exchangeCallback(callback)
        #expect(tokens.refreshToken == "issuer-refresh")
        let requests = await transport.requests
        #expect(requests.count == 1)
        let request = try #require(requests.first)
        #expect(request.url == URL(string: "https://issuer.example/api/auth/oauth2/token"))
        let form = try #require(String(data: try #require(request.httpBody), encoding: .utf8))
        let items = try #require(URLComponents(string: "https://form.example/?" + form)?.queryItems)
        #expect(items.first { $0.name == "client_id" }?.value == "public-mac")
        #expect(items.first { $0.name == "resource" }?.value == "https://issuer.example/api")
        #expect(items.first { $0.name == "redirect_uri" }?.value == redirect.absoluteString)
        let verifier = try #require(items.first { $0.name == "code_verifier" }?.value)
        #expect(try OAuthPKCEChallenge(verifier: verifier).challenge == query.first { $0.name == "code_challenge" }?.value)
        await #expect(throws: AuthError.invalidCallback) { try await flow.exchangeCallback(callback) }
        #expect(await transport.requests.count == 1)
    }

    @Test("Unissued, duplicate, malformed and raw-token callbacks never reach token endpoint", arguments: [
        "cmux-w3dev://auth-callback?code=x&state=unissued",
        "cmux-w3dev://auth-callback?code=x&state=issued&state=issued",
        "cmux-w3dev://auth-callback?code=x&code=y&state=issued",
        "cmux-w3dev://auth-callback?stack_access=access&stack_refresh=refresh&state=issued",
        "cmux://auth-callback?code=x&state=issued",
        "cmux-w3dev://different-path?code=x&state=issued",
        "cmux-w3dev://auth-callback?code=x",
        "cmux-w3dev://auth-callback?code=x&state=issued#access_token=secret"
    ])
    func rejectsUntrustedCallbacks(_ callback: String) async throws {
        let transport = OAuthRecordingTransport()
        let flow = OAuthAuthorizationFlow(configuration: OAuthClientConfiguration(origin: origin, clientID: "public-mac", redirectURI: redirect), transport: transport)
        _ = flow.authorizationURL(state: "issued")
        await #expect(throws: AuthError.invalidCallback) { try await flow.exchangeCallback(URL(string: callback)!) }
        #expect(await transport.requests.isEmpty)
    }

    @Test("API identity and organizations use bearer access only")
    func bearerIdentityAndOrganizationMapping() async throws {
        let transport = OAuthRecordingTransport()
        let store = OAuthMemoryTokenStore(tokens: OAuthTokenSet(accessToken: "access-only", refreshToken: "local-secret", expiresAt: Date().addingTimeInterval(3600)))
        let config = OAuthClientConfiguration(origin: origin, clientID: "public-mac", redirectURI: redirect)
        let client = BetterAuthClient(configuration: config, store: store, transport: transport, browser: OAuthAuthorizationFlow(configuration: config, transport: transport))
        let user = try await client.currentUser(throwOnMissing: true)
        #expect(user?.id == "user-1")
        #expect(try await client.listTeams().map(\.id) == ["org-1"])
        #expect(try await client.selectedTeamID() == "org-1")
        let requests = await transport.requests
        #expect(requests.count == 3)
        for request in requests {
            #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer access-only")
            #expect(request.value(forHTTPHeaderField: "X-Stack-Refresh-Token") == nil)
            #expect(request.httpBody == nil)
        }
        #expect(await store.currentRefreshToken() == "local-secret")
    }
    @Test("Host browser sign-in routes the OAuth standard state into the code exchange")
    func hostBrowserAcceptsStandardOAuthState() async throws {
        let defaults = FakeKeyValueStore()
        let store = FlowInMemoryTokenStore()
        let user = CMUXAuthUser(id: "oauth-user", primaryEmail: "native@example.com", displayName: "Native User")
        let client = FlowFakeAuthClient(user: user, store: store)
        let coordinator = AuthCoordinator(client: client,
            sessionCache: CMUXAuthSessionCache(keyValueStore: defaults, key: "tokens"),
            userCache: CMUXAuthIdentityStore(keyValueStore: defaults, key: "user"),
            teamSelection: CMUXAuthTeamSelectionStore(keyValueStore: defaults, key: "org"),
            anchor: FakeAnchor(), config: .test, launch: .plain())
        let factory = FakeBrowserAuthSessionFactory()
        let flow = HostBrowserSignInFlow(coordinator: coordinator, tokenStore: store,
            sessionFactory: factory, callbackRouter: AuthCallbackRouter(),
            makeSignInURL: { URL(string: "https://issuer.example/authorize?state=" + $0)! },
            callbackScheme: { "cmux-w3dev" },
            callbackExchange: { url, _ in
                guard URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "code" })?.value == "authorization-code" else { throw AuthError.invalidCallback }
                await store.seed(accessToken: "exchanged-access", refreshToken: "exchanged-refresh")
                return AuthCallbackPayload(refreshToken: "exchanged-refresh", accessToken: "exchanged-access")
            }, openExternalURL: { _ in false })
        let attempt = flow.beginSignIn()
        await factory.sessionsDidReach(1)
        let session = try #require(factory.sessions.first)
        let state = try #require(URLComponents(url: session.signInURL, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "state" })?.value)
        let signedIn = await flow.handleCallbackURL(URL(string: "cmux-w3dev://auth-callback?code=authorization-code&state=" + state)!)
        #expect(signedIn)
        #expect(await attempt.value)
        #expect(coordinator.currentUser?.id == "oauth-user")
    }

    @Test("A late refresh response cannot restore a signed-out session")
    func refreshCompletingAfterSignOutDoesNotResurrectSession() async throws {
        let transport = OAuthRecordingTransport(holdTokenRequest: true)
        let store = OAuthMemoryTokenStore(tokens: OAuthTokenSet(accessToken: "expired", refreshToken: "captured-refresh", expiresAt: Date().addingTimeInterval(-1)))
        let config = OAuthClientConfiguration(origin: origin, clientID: "public-mac", redirectURI: redirect)
        let client = BetterAuthClient(configuration: config, store: store, transport: transport, browser: OAuthAuthorizationFlow(configuration: config, transport: transport))
        let refresh = Task { await client.forceRefreshAccessToken() }
        await transport.waitForTokenRequest()
        await client.clearLocalSession()
        await transport.releaseTokenRequest()
        #expect(await refresh.value == nil)
        #expect(try await store.load() == nil)
    }

    @Test("A replaced held OAuth exchange cannot overwrite or clear the newer host session")
    func replacingAnExternalCodeExchangePreservesTheNewSession() async throws {
        let transport = OAuthRecordingTransport(
            holdTokenRequest: true,
            heldAuthorizationCode: "first-code",
            codeResponses: [
                "first-code": #"{"access_token":"first-access","refresh_token":"first-refresh","token_type":"Bearer","expires_in":3600}"#,
                "second-code": #"{"access_token":"second-access","refresh_token":"second-refresh","token_type":"Bearer","expires_in":3600}"#,
            ]
        )
        let store = OAuthMemoryTokenStore()
        let config = OAuthClientConfiguration(origin: origin, clientID: "public-mac", redirectURI: redirect)
        let browser = OAuthAuthorizationFlow(configuration: config, transport: transport)
        let client = BetterAuthClient(configuration: config, store: store, transport: transport, browser: browser)
        let defaults = FakeKeyValueStore()
        let coordinator = AuthCoordinator(
            client: client,
            sessionCache: CMUXAuthSessionCache(keyValueStore: defaults, key: "tokens"),
            userCache: CMUXAuthIdentityStore(keyValueStore: defaults, key: "user"),
            teamSelection: CMUXAuthTeamSelectionStore(keyValueStore: defaults, key: "org"),
            anchor: FakeAnchor(), config: .test, launch: .plain()
        )
        let factory = FakeBrowserAuthSessionFactory()
        let host = HostBrowserSignInFlow(
            coordinator: coordinator, tokenStore: store,
            sessionFactory: factory, callbackRouter: AuthCallbackRouter(extraAllowedScheme: "cmux-w3dev"),
            makeSignInURL: { browser.authorizationURL(state: $0) },
            callbackScheme: { "cmux-w3dev" },
            callbackExchange: { try await client.completeBrowserCallback($0, attemptGeneration: $1) },
            openExternalURL: { _ in false }
        )
        let firstAttempt = host.beginSignIn()
        await factory.sessionsDidReach(1)
        let firstSession = try #require(factory.sessions.first)
        let firstState = try #require(URLComponents(url: firstSession.signInURL, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "state" })?.value)
        let firstDelivery = Task { await host.handleCallbackURL(
            URL(string: "cmux-w3dev://auth-callback?code=first-code&state=" + firstState)!
        ) }
        await transport.waitForTokenRequest()

        let secondAttempt = host.beginSignIn(selectAccount: true)
        await factory.sessionsDidReach(2)
        let secondSession = try #require(factory.sessions.last)
        let secondState = try #require(URLComponents(url: secondSession.signInURL, resolvingAgainstBaseURL: false)?
            .queryItems?.first(where: { $0.name == "state" })?.value)
        #expect(await host.handleCallbackURL(
            URL(string: "cmux-w3dev://auth-callback?code=second-code&state=" + secondState)!
        ))
        #expect(await secondAttempt.value)
        #expect(try await store.load()?.refreshToken == "second-refresh")

        await transport.releaseTokenRequest()
        #expect(await firstDelivery.value == false)
        _ = await firstAttempt.value
        #expect(coordinator.isAuthenticated)
        #expect(try await store.load()?.accessToken == "second-access")
        #expect(try await store.load()?.refreshToken == "second-refresh")
        #expect(host.lastFailure == nil)
    }

    @Test("Delayed cancellation of an old receipt preserves a newer pending exchange")
    func cancellationTargetsOnlyItsAuthorizationGeneration() async throws {
        let transport = OAuthRecordingTransport(holdTokenRequest: true)
        let store = OAuthMemoryTokenStore()
        let config = OAuthClientConfiguration(origin: origin, clientID: "public-mac", redirectURI: redirect)
        let browser = OAuthAuthorizationFlow(configuration: config, transport: transport)
        let client = BetterAuthClient(configuration: config, store: store, transport: transport, browser: browser)
        let oldGeneration = try #require(try await client.prepareBrowserSignIn())
        let newGeneration = try #require(try await client.prepareBrowserSignIn())
        _ = browser.authorizationURL(state: "new-state")
        let exchange = Task { try await client.completeBrowserCallback(
            URL(string: "cmux-w3dev://auth-callback?code=new-code&state=new-state")!, attemptGeneration: newGeneration
        ) }
        await transport.waitForTokenRequest()
        await client.cancelBrowserSignIn(attemptGeneration: oldGeneration)
        await transport.releaseTokenRequest()
        let payload = try await exchange.value
        #expect(payload.refreshToken == "issuer-refresh")
        #expect(try await store.load()?.refreshToken == "issuer-refresh")
    }

    @Test("An old cancellation cannot invalidate newer ownership while preparation is suspended")
    func cancellationDuringNewAuthorizationPreparationPreservesTheNewOwner() async throws {
        let transport = OAuthRecordingTransport()
        let store = OAuthMemoryTokenStore()
        let config = OAuthClientConfiguration(origin: origin, clientID: "public-mac", redirectURI: redirect)
        let browser = OAuthAuthorizationFlow(configuration: config, transport: transport)
        let client = BetterAuthClient(configuration: config, store: store, transport: transport, browser: browser)
        let oldGeneration = try #require(try await client.prepareBrowserSignIn())
        await store.pauseNextAuthorizationPreparation()
        let preparation = Task { try await client.prepareBrowserSignIn() }
        await store.waitForAuthorizationPreparation()
        await client.cancelBrowserSignIn(attemptGeneration: oldGeneration)
        await store.releaseAuthorizationPreparation()
        let newGeneration = try #require(try await preparation.value)
        #expect(newGeneration != oldGeneration)
        _ = browser.authorizationURL(state: "new-state")
        let payload = try await client.completeBrowserCallback(
            URL(string: "cmux-w3dev://auth-callback?code=new-code&state=new-state")!, attemptGeneration: newGeneration
        )
        #expect(payload.authorizationGeneration == newGeneration)
        #expect(try await store.load()?.refreshToken == "issuer-refresh")
    }

    @Test("An already-canceled preparation cannot invalidate the current authorization owner")
    func canceledPreparationDoesNotAdvanceStorageOwnership() async throws {
        let transport = OAuthRecordingTransport()
        let store = OAuthMemoryTokenStore()
        let config = OAuthClientConfiguration(origin: origin, clientID: "public-mac", redirectURI: redirect)
        let browser = OAuthAuthorizationFlow(configuration: config, transport: transport)
        let client = BetterAuthClient(configuration: config, store: store, transport: transport, browser: browser)
        let currentGeneration = try #require(try await client.prepareBrowserSignIn())
        let canceledPreparation = Task { try await client.prepareBrowserSignIn() }
        canceledPreparation.cancel()
        await #expect(throws: CancellationError.self) { _ = try await canceledPreparation.value }
        _ = browser.authorizationURL(state: "current-state")
        let payload = try await client.completeBrowserCallback(
            URL(string: "cmux-w3dev://auth-callback?code=current-code&state=current-state")!,
            attemptGeneration: currentGeneration
        )
        #expect(payload.authorizationGeneration == currentGeneration)
        #expect(try await store.load()?.refreshToken == "issuer-refresh")
    }

    @Test("Cancellation during preparation expires only that receipt after a newer owner is ready")
    func cancellationOfSuspendedPreparationPreservesLaterAuthorization() async throws {
        let transport = OAuthRecordingTransport()
        let store = OAuthMemoryTokenStore()
        let config = OAuthClientConfiguration(origin: origin, clientID: "public-mac", redirectURI: redirect)
        let browser = OAuthAuthorizationFlow(configuration: config, transport: transport)
        let client = BetterAuthClient(configuration: config, store: store, transport: transport, browser: browser)
        await store.pauseNextAuthorizationPreparation()
        let canceledPreparation = Task { try await client.prepareBrowserSignIn() }
        await store.waitForAuthorizationPreparation()
        canceledPreparation.cancel()
        let currentGeneration = try #require(try await client.prepareBrowserSignIn())
        await store.releaseAuthorizationPreparation()
        await #expect(throws: CancellationError.self) { _ = try await canceledPreparation.value }
        _ = browser.authorizationURL(state: "current-state")
        let payload = try await client.completeBrowserCallback(
            URL(string: "cmux-w3dev://auth-callback?code=current-code&state=current-state")!,
            attemptGeneration: currentGeneration
        )
        #expect(payload.authorizationGeneration == currentGeneration)
        #expect(try await store.load()?.refreshToken == "issuer-refresh")
    }

    @Test("A definitive refresh rejection clears only the captured session")
    func invalidGrantClearsRefreshCredentials() async throws {
        let transport = OAuthRecordingTransport(tokenStatus: 400, tokenBody: #"{"error":"invalid_grant"}"#)
        let store = OAuthMemoryTokenStore(tokens: OAuthTokenSet(accessToken: "expired", refreshToken: "rejected", expiresAt: Date().addingTimeInterval(-1)))
        let config = OAuthClientConfiguration(origin: origin, clientID: "public-mac", redirectURI: redirect)
        let client = BetterAuthClient(configuration: config, store: store, transport: transport, browser: OAuthAuthorizationFlow(configuration: config, transport: transport))
        #expect(try await client.resolvedAccessToken(forceRefresh: false) == nil)
        #expect(try await store.load() == nil)
    }

    @Test("A transient issuer failure preserves the renewable session")
    func transientRefreshFailurePreservesCredentials() async throws {
        let transport = OAuthRecordingTransport(tokenStatus: 503, tokenBody: #"{"error":"temporarily_unavailable"}"#)
        let tokens = OAuthTokenSet(accessToken: "expired", refreshToken: "retryable", expiresAt: Date().addingTimeInterval(-1))
        let store = OAuthMemoryTokenStore(tokens: tokens)
        let config = OAuthClientConfiguration(origin: origin, clientID: "public-mac", redirectURI: redirect)
        let client = BetterAuthClient(configuration: config, store: store, transport: transport, browser: OAuthAuthorizationFlow(configuration: config, transport: transport))
        await #expect(throws: AuthError.networkError) { try await client.resolvedAccessToken(forceRefresh: false) }
        #expect(try await store.load() == tokens)
    }

}
