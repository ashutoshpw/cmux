/// Validates the identity fields for a tagged Debug cmux server.
public struct CodeRouterDebugServerIdentityPolicy {
    private let expectedTeamIdentifier: String?

    /// Creates a Debug server identity policy pinned to the executing fork team.
    /// - Parameter expectedTeamIdentifier: The verified team expected on the peer.
    public init(expectedTeamIdentifier: String? = CodeSigningTeamIdentity().currentTeamIdentifier()) {
        self.expectedTeamIdentifier = expectedTeamIdentifier
    }

    /// Tests whether the signing fields match the expected tagged cmux build.
    ///
    /// - Parameters:
    ///   - identifier: The connected server's code-signing identifier.
    ///   - teamIdentifier: The connected server's signing team.
    ///   - expectedBundleIdentifier: The tagged bundle identifier selected by
    ///     the CLI environment.
    /// - Returns: `true` only for the exact expected company-signed Debug app.
    public func isAllowed(
        identifier: String?,
        teamIdentifier: String?,
        expectedBundleIdentifier: String?
    ) -> Bool {
        let taggedPrefix = "app.w3dev.cmux.debug."
        guard let expectedBundleIdentifier,
              expectedBundleIdentifier.hasPrefix(taggedPrefix),
              expectedBundleIdentifier.count > taggedPrefix.count,
              identifier == expectedBundleIdentifier,
              let expectedTeamIdentifier,
              !expectedTeamIdentifier.isEmpty,
              teamIdentifier == expectedTeamIdentifier else {
            return false
        }
        return true
    }
}
