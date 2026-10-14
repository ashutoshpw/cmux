import Testing
@testable import CmuxSettings

@Test func markerFilesAreVariantAware() {
    #expect(SocketPathMarkerFiles.variant(
        bundleIdentifier: "app.w3dev.cmux",
        environment: [:]
    ) == .stable)
    #expect(SocketPathMarkerFiles.variant(
        bundleIdentifier: "app.w3dev.cmux.nightly",
        environment: [:]
    ) == .nightly(slug: nil))
    #expect(SocketPathMarkerFiles.variant(
        bundleIdentifier: "app.w3dev.cmux.rc",
        environment: [:]
    ) == .rc(slug: nil))
    #expect(SocketPathMarkerFiles.variant(
        bundleIdentifier: "app.w3dev.cmux.rc.my-feature",
        environment: [:]
    ) == .rc(slug: "my-feature"))
    #expect(SocketPathMarkerFiles.variant(
        bundleIdentifier: "app.w3dev.cmux.debug.agent",
        environment: [:]
    ) == .dev(slug: "agent"))
    #expect(SocketPathMarkerFiles.variant(
        bundleIdentifier: "app.w3dev.cmux.debug",
        environment: ["CMUX_TAG": "Issue 3542"]
    ) == .dev(slug: "issue-3542"))
    #expect(SocketPathMarkerFiles.variant(
        bundleIdentifier: "app.w3dev.cmux.debug",
        environment: ["CMUX_TAG": "café"]
    ) == .dev(slug: "caf"))
}

@Test func defaultSocketPathsStayVariantScoped() {
    #expect(SocketPathMarkerFiles.defaultSocketPath(
        bundleIdentifier: "app.w3dev.cmux",
        environment: [:],
        isDebugBuild: false,
        stableSocketPath: "/stable/cmux.sock"
    ) == "/stable/cmux.sock")
    #expect(SocketPathMarkerFiles.defaultSocketPath(
        bundleIdentifier: "app.w3dev.cmux.nightly",
        environment: [:],
        isDebugBuild: false,
        stableSocketPath: "/stable/cmux.sock"
    ) == "/tmp/cmux-w3dev-nightly.sock")
    #expect(SocketPathMarkerFiles.defaultSocketPath(
        bundleIdentifier: "app.w3dev.cmux.rc",
        environment: [:],
        isDebugBuild: false,
        stableSocketPath: "/stable/cmux.sock"
    ) == "/tmp/cmux-w3dev-rc.sock")
    #expect(SocketPathMarkerFiles.defaultSocketPath(
        bundleIdentifier: "app.w3dev.cmux.rc.candidate1",
        environment: [:],
        isDebugBuild: false,
        stableSocketPath: "/stable/cmux.sock"
    ) == "/tmp/cmux-w3dev-rc-candidate1.sock")
    #expect(SocketPathMarkerFiles.defaultSocketPath(
        bundleIdentifier: "app.w3dev.cmux.staging.my-feature",
        environment: [:],
        isDebugBuild: false,
        stableSocketPath: "/stable/cmux.sock"
    ) == "/tmp/cmux-w3dev-staging-my-feature.sock")
    #expect(SocketPathMarkerFiles.defaultSocketPath(
        bundleIdentifier: "app.w3dev.cmux.debug",
        environment: ["CMUX_TAG": "Issue 3542"],
        isDebugBuild: false,
        stableSocketPath: "/stable/cmux.sock"
    ) == "/tmp/cmux-w3dev-debug-issue-3542.sock")
}
