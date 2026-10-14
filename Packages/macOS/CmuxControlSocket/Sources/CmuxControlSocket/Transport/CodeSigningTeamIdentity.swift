import Foundation
import Security

/// Reads the executing fork binary's verified signing team for peer trust checks.
///
/// Signing requirements must derive their team from signed code rather than
/// an inherited environment variable or the upstream project's team identity.
public struct CodeSigningTeamIdentity: Sendable {
    /// Creates a reader for the executing process's code signature.
    public init() {}

    /// Returns the executing binary's Apple signing team, failing closed for unsigned code.
    /// - Returns: The validated ten-character team identifier, or nil.
    public func currentTeamIdentifier() -> String? {
        var code: SecCode?
        guard SecCodeCopySelf([], &code) == errSecSuccess, let code,
              SecCodeCheckValidity(code, SecCSFlags(rawValue: UInt32(kSecCSStrictValidate)), nil) == errSecSuccess else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, [], &staticCode) == errSecSuccess, let staticCode else { return nil }
        var information: CFDictionary?
        guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: UInt32(kSecCSSigningInformation)), &information) == errSecSuccess,
              let fields = information as? [String: Any],
              let team = fields[kSecCodeInfoTeamIdentifier as String] as? String,
              team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { return nil }
        return team
    }
}
