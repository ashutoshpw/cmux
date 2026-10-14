import Foundation
import Testing
@testable import CMUXMobileCore

@Suite struct MobileIOSAppNamespaceTests {
    @Test(
        arguments: [
            "app.w3dev.cmux.ios",
            "app.w3dev.cmux.ios.beta",
            "app.w3dev.cmux.ios.internal",
            "app.w3dev.cmux.ios.demo",
            "app.w3dev.cmux.ios.debug.feature-a",
            "app.w3dev.cmux.ios.debug.feature-b",
        ]
    )
    func fullBundleIdentifierOwnsEveryNamespace(bundleIdentifier: String) throws {
        let namespace = try #require(
            MobileIOSAppNamespace(bundleIdentifier: bundleIdentifier)
        )

        #expect(namespace.bundleIdentifier == bundleIdentifier)
        #expect(
            namespace.keychainService(base: "app.w3dev.cmux.iroh.identity")
                == "app.w3dev.cmux.iroh.identity.\(bundleIdentifier)"
        )
        #expect(
            namespace.keychainAccessGroup(teamIdentifier: "7WLXT3NR37")
                == "7WLXT3NR37.\(bundleIdentifier)"
        )
        #expect(
            namespace.pairingURLScheme
                == "cmux-w3dev-ios-\(bundleIdentifier)"
        )
    }

    @Test func appTypesAndDevTagsNeverSharePersistentOrPairingScopes() throws {
        let bundleIdentifiers = [
            "app.w3dev.cmux.ios",
            "app.w3dev.cmux.ios.beta",
            "app.w3dev.cmux.ios.internal",
            "app.w3dev.cmux.ios.demo",
            "app.w3dev.cmux.ios.debug.feature-a",
            "app.w3dev.cmux.ios.debug.feature-b",
        ]
        let namespaces = try bundleIdentifiers.map {
            try #require(MobileIOSAppNamespace(bundleIdentifier: $0))
        }

        #expect(Set(namespaces.map(\.serverScope)).count == namespaces.count)
        #expect(Set(namespaces.map(\.pairingURLScheme)).count == namespaces.count)
        #expect(
            Set(
                namespaces.map {
                    $0.keychainService(base: "app.w3dev.cmux.iroh.identity")
                }
            ).count == namespaces.count
        )
    }

    @Test func rejectsMissingOrUnsafeBundleIdentifiers() {
        #expect(MobileIOSAppNamespace(bundleIdentifier: nil) == nil)
        #expect(MobileIOSAppNamespace(bundleIdentifier: "") == nil)
        #expect(MobileIOSAppNamespace(bundleIdentifier: "Dev.cmux.ios.feature-a") == nil)
        #expect(MobileIOSAppNamespace(bundleIdentifier: "app.w3dev.cmux.ios.debug.*") == nil)
        #expect(MobileIOSAppNamespace(bundleIdentifier: "dev cmux ios") == nil)
    }

    @Test func macInstanceTagResolvesOneExactIOSBundle() {
        #expect(
            MobileIOSAppNamespace(pairedMacInstanceTag: "feature-a")?.bundleIdentifier
                == "app.w3dev.cmux.ios.debug.feature-a"
        )
        #expect(
            MobileIOSAppNamespace(pairedMacInstanceTag: "default")?.bundleIdentifier
                == "app.w3dev.cmux.ios"
        )
        #expect(MobileIOSAppNamespace(pairedMacInstanceTag: "invalid tag") == nil)
        #expect(MobileIOSAppNamespace(pairedMacInstanceTag: " feature-a ") == nil)
    }

    @Test func legacyBackupAdoptionIsLimitedToUnambiguousOwners() throws {
        let appStore = try #require(
            MobileIOSAppNamespace(bundleIdentifier: "app.w3dev.cmux.ios")
        )
        let tagged = try #require(
            MobileIOSAppNamespace(bundleIdentifier: "app.w3dev.cmux.ios.debug.feature-a")
        )
        #expect(appStore.legacyBackupScope == .unscoped)
        #expect(
            tagged.legacyBackupScope
                == .scoped("ios:v2:ZmVhdHVyZS1h")
        )
        for bundleIdentifier in [
            "app.w3dev.cmux.ios.beta",
            "app.w3dev.cmux.ios.internal",
            "app.w3dev.cmux.ios.demo",
        ] {
            #expect(
                MobileIOSAppNamespace(
                    bundleIdentifier: bundleIdentifier
                )?.legacyBackupScope == nil
            )
        }
    }
}
