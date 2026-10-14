import CryptoKit
public import Foundation

/// RFC 7636 proof key and its S256 challenge for one authorization attempt.
public struct OAuthPKCEChallenge: Sendable {
    /// The secret proof key, sent only to the issuer's token endpoint.
    public let verifier: String
    /// The SHA-256 proof-key hash sent to the authorization endpoint.
    public let challenge: String

    /// Generates a 256-bit proof key using the system random number generator.
    public init() {
        var random = SystemRandomNumberGenerator()
        let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &random) }
        self.init(validatedVerifier: Self.base64URL(Data(bytes)))
    }

    /// Creates a challenge from an RFC 7636 verifier.
    /// - Parameter verifier: Between 43 and 128 unreserved ASCII characters.
    /// - Throws: An invalid-callback error for an invalid verifier.
    public init(verifier: String) throws {
        let allowed = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        guard (43...128).contains(verifier.utf8.count), verifier.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { throw AuthError.invalidCallback }
        self.init(validatedVerifier: verifier)
    }

    private init(validatedVerifier: String) {
        verifier = validatedVerifier
        challenge = Self.base64URL(Data(SHA256.hash(data: Data(validatedVerifier.utf8))))
    }
    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
