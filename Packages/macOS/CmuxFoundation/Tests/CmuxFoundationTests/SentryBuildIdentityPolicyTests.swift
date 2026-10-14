import Testing
@testable import CmuxFoundation

@Suite struct SentryBuildIdentityPolicyTests {
    private static let base = "app.w3dev.cmux"

    @Test(arguments: [
        "app.w3dev.cmux",
        "app.w3dev.cmux.nightly",
        "app.w3dev.cmux.nightly.rc1",
        "app.w3dev.cmux.rc",
        "app.w3dev.cmux.rc.candidate1",
        "app.w3dev.cmux.staging",
        "app.w3dev.cmux.debug",
        "app.w3dev.cmux.debug.snmsc",
        " app.w3dev.cmux "
    ])
    func allowsCmuxBuildIdentities(_ bundleIdentifier: String) {
        #expect(SentryBuildIdentityPolicy(
            bundleIdentifier: bundleIdentifier,
            trustedBaseBundleIdentifier: Self.base
        ).allowsTelemetry)
    }

    @Test(arguments: [
        "mosaic.com.emergent.app",
        "com.emergent.mosaic",
        "app.w3dev.cmuxlication",
        "app.w3dev.cmux",
        "org.example.cmux",
        "",
        " "
    ])
    func deniesForeignBuildIdentities(_ bundleIdentifier: String) {
        #expect(!SentryBuildIdentityPolicy(
            bundleIdentifier: bundleIdentifier,
            trustedBaseBundleIdentifier: Self.base
        ).allowsTelemetry)
    }

    @Test func deniesMissingBuildIdentity() {
        #expect(!SentryBuildIdentityPolicy(
            bundleIdentifier: nil,
            trustedBaseBundleIdentifier: Self.base
        ).allowsTelemetry)
    }
}
