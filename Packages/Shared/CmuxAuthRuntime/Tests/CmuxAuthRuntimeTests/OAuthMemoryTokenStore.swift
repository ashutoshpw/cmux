import Foundation
@testable import CmuxAuthRuntime

actor OAuthMemoryTokenStore: OAuthTokenStoring {
    private var tokens: OAuthTokenSet?
    private var latestAuthorizationGeneration: UInt64 = 0
    private var authorizationGeneration: UInt64?
    private var persistedAuthorizationGeneration: UInt64?
    private var pausesNextAuthorization = false
    private var authorizationPreparedWaiters: [CheckedContinuation<Void, Never>] = []
    private var authorizationReturnWaiter: CheckedContinuation<Void, Never>?
    init(tokens: OAuthTokenSet? = nil) { self.tokens = tokens }
    func load() async throws -> OAuthTokenSet? { tokens }
    func save(_ tokens: OAuthTokenSet) async throws {
        self.tokens = tokens
        authorizationGeneration = nil
        persistedAuthorizationGeneration = nil
    }
    func beginAuthorization(generation: UInt64) async -> Bool {
        guard generation > latestAuthorizationGeneration else { return false }
        latestAuthorizationGeneration = generation
        authorizationGeneration = generation
        if pausesNextAuthorization {
            pausesNextAuthorization = false
            await withCheckedContinuation { continuation in
                authorizationReturnWaiter = continuation
                let waiters = authorizationPreparedWaiters
                authorizationPreparedWaiters = []
                for waiter in waiters { waiter.resume() }
            }
        }
        return true
    }
    func pauseNextAuthorizationPreparation() { pausesNextAuthorization = true }
    func waitForAuthorizationPreparation() async {
        if authorizationReturnWaiter != nil { return }
        await withCheckedContinuation { authorizationPreparedWaiters.append($0) }
    }
    func releaseAuthorizationPreparation() {
        authorizationReturnWaiter?.resume()
        authorizationReturnWaiter = nil
    }
    func save(_ tokens: OAuthTokenSet, ifAuthorizationGenerationMatches generation: UInt64) async throws -> Bool {
        guard authorizationGeneration == generation else { return false }
        self.tokens = tokens
        persistedAuthorizationGeneration = generation
        return true
    }
    func invalidateAuthorization(generation: UInt64) async {
        if authorizationGeneration == generation { authorizationGeneration = nil }
    }
    func clearAuthorization(generation: UInt64) async throws -> Bool {
        guard persistedAuthorizationGeneration == generation else { return false }
        tokens = nil
        invalidateCompletedAuthorization()
        return true
    }
    func replace(_ tokens: OAuthTokenSet?, ifRefreshTokenMatches refreshToken: String) async throws -> Bool {
        guard self.tokens?.refreshToken == refreshToken else { return false }
        self.tokens = tokens
        if tokens == nil { invalidateCompletedAuthorization() }
        return true
    }
    func getStoredAccessToken() async -> String? { tokens?.accessToken }
    func getStoredRefreshToken() async -> String? { tokens?.refreshToken }
    func setTokens(accessToken: String?, refreshToken: String?) async {
        if let accessToken, let refreshToken { tokens = OAuthTokenSet(accessToken: accessToken, refreshToken: refreshToken, expiresAt: Date().addingTimeInterval(3600)) }
        else { tokens = nil }
    }
    func clearTokens() async {
        tokens = nil
        authorizationGeneration = nil
        persistedAuthorizationGeneration = nil
    }
    func compareAndSet(compareRefreshToken: String, newRefreshToken: String?, newAccessToken: String?) async {
        guard tokens?.refreshToken == compareRefreshToken else { return }
        await setTokens(accessToken: newAccessToken, refreshToken: newRefreshToken)
    }
    func clearTokensIfCurrent(accessToken: String?, refreshToken: String?) async -> Bool {
        guard tokens?.accessToken == accessToken, tokens?.refreshToken == refreshToken else { return false }
        tokens = nil
        invalidateCompletedAuthorization()
        return true
    }
    private func invalidateCompletedAuthorization() {
        if authorizationGeneration == persistedAuthorizationGeneration { authorizationGeneration = nil }
        persistedAuthorizationGeneration = nil
    }
}
