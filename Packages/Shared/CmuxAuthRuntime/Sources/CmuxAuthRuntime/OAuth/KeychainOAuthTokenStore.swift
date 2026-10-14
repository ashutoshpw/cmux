public import Foundation
import Security

/// Stores fork OAuth credentials as one device-bound Keychain item.
///
/// Every installation and issuer gets its own service. The store never adopts
/// upstream Stack credentials and never falls back to an unencrypted file.
public actor KeychainOAuthTokenStore: OAuthTokenStoring {
    private let service: String
    private let accessGroup: String?
    private var latestAuthorizationGeneration: UInt64 = 0
    private var authorizationGeneration: UInt64?
    private var persistedAuthorizationGeneration: UInt64?

    /// Creates secure storage for one exact installation and issuer.
    /// - Parameters:
    ///   - service: Bundle- and issuer-scoped service identifier.
    ///   - accessGroup: The exact signed Keychain access group, if supplied.
    public init(service: String, accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    public func load() async throws -> OAuthTokenSet? { try read() }

    private func read() throws -> OAuthTokenSet? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw AuthError.networkError
        }
        return try JSONDecoder().decode(OAuthTokenSet.self, from: data)
    }

    public func save(_ tokens: OAuthTokenSet) async throws {
        try write(tokens)
        authorizationGeneration = nil
        persistedAuthorizationGeneration = nil
    }

    public func beginAuthorization(generation: UInt64) async -> Bool {
        guard generation > latestAuthorizationGeneration else { return false }
        latestAuthorizationGeneration = generation
        authorizationGeneration = generation
        return true
    }

    public func save(_ tokens: OAuthTokenSet, ifAuthorizationGenerationMatches generation: UInt64) async throws -> Bool {
        guard authorizationGeneration == generation else { return false }
        // The ownership check and Keychain write do not suspend inside this actor.
        try write(tokens)
        persistedAuthorizationGeneration = generation
        return true
    }

    public func invalidateAuthorization(generation: UInt64) async {
        if authorizationGeneration == generation { authorizationGeneration = nil }
    }

    public func clearAuthorization(generation: UInt64) async throws -> Bool {
        guard persistedAuthorizationGeneration == generation else { return false }
        try delete()
        invalidateCompletedAuthorization()
        return true
    }

    private func write(_ tokens: OAuthTokenSet) throws {
        let data = try JSONEncoder().encode(tokens)
        let update = SecItemUpdate(baseQuery as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw AuthError.networkError }
        var query = baseQuery
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw AuthError.networkError }
    }

    public func replace(_ tokens: OAuthTokenSet?, ifRefreshTokenMatches refreshToken: String) async throws -> Bool {
        guard try read()?.refreshToken == refreshToken else { return false }
        if let tokens { try write(tokens) } else {
            try delete()
            invalidateCompletedAuthorization()
        }
        return true
    }

    public func getStoredAccessToken() async -> String? { try? await load()?.accessToken }
    public func getStoredRefreshToken() async -> String? { try? await load()?.refreshToken }
    public func setTokens(accessToken: String?, refreshToken: String?) async {
        // Legacy protocol writes do not own the OAuth exchange. Production
        // exchanges call save(_:) so persistence failures remain observable.
        guard let accessToken, let refreshToken else { await clearTokens(); return }
        do {
            let current = try read()
            if current?.accessToken == accessToken, current?.refreshToken == refreshToken { return }
            try await save(OAuthTokenSet(accessToken: accessToken, refreshToken: refreshToken, expiresAt: Date()))
        } catch {
            AuthDebugLog().log("auth.oauth.keychain.writeFailed")
        }
    }
    public func clearTokens() async {
        authorizationGeneration = nil
        persistedAuthorizationGeneration = nil
        do { try delete() } catch { AuthDebugLog().log("auth.oauth.keychain.clearFailed") }
    }
    public func compareAndSet(compareRefreshToken: String, newRefreshToken: String?, newAccessToken: String?) async {
        do {
            let replacement: OAuthTokenSet?
            if let newRefreshToken, let newAccessToken {
                replacement = OAuthTokenSet(accessToken: newAccessToken, refreshToken: newRefreshToken, expiresAt: Date())
            } else { replacement = nil }
            _ = try await replace(replacement, ifRefreshTokenMatches: compareRefreshToken)
        } catch { AuthDebugLog().log("auth.oauth.keychain.rotationFailed") }
    }
    public func clearTokensIfCurrent(accessToken: String?, refreshToken: String?) async -> Bool {
        do {
            let current = try read()
            guard current?.accessToken == accessToken, current?.refreshToken == refreshToken else { return false }
            try delete()
            invalidateCompletedAuthorization()
            return true
        } catch { return false }
    }

    private var baseQuery: [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "oauth-session-v1",
            kSecUseDataProtectionKeychain as String: true
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }
    private func invalidateCompletedAuthorization() {
        if authorizationGeneration == persistedAuthorizationGeneration { authorizationGeneration = nil }
        persistedAuthorizationGeneration = nil
    }
    private func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AuthError.networkError }
    }
}
