import Foundation
import Testing
@testable import CmuxBrowser

@Suite struct BrowserHistoryLocationTests {
    @Test func foldsDebugAndStagingNamespaces() {
        #expect(BrowserHistoryLocation.normalizedNamespace(bundleIdentifier: "app.w3dev.cmux.debug.my-tag") == "app.w3dev.cmux.debug")
        #expect(BrowserHistoryLocation.normalizedNamespace(bundleIdentifier: "app.w3dev.cmux.staging.rc") == "app.w3dev.cmux.staging")
        #expect(BrowserHistoryLocation.normalizedNamespace(bundleIdentifier: "app.w3dev.cmux") == "app.w3dev.cmux")
    }

    @Test func historyFileURLNestsUnderNamespace() {
        let root = URL(fileURLWithPath: "/tmp/appsupport", isDirectory: true)
        let location = BrowserHistoryLocation(applicationSupportDirectory: root, bundleIdentifier: "app.w3dev.cmux.debug.tag")
        #expect(location.namespace == "app.w3dev.cmux.debug")
        #expect(location.historyFileURL.path == "/tmp/appsupport/app.w3dev.cmux.debug/browser_history.json")
    }

    @Test func legacyURLPresentOnlyWhenNamespaceDiffers() {
        let root = URL(fileURLWithPath: "/tmp/appsupport", isDirectory: true)
        let tagged = BrowserHistoryLocation(applicationSupportDirectory: root, bundleIdentifier: "app.w3dev.cmux.debug.tag")
        #expect(tagged.legacyTaggedHistoryFileURL?.path == "/tmp/appsupport/app.w3dev.cmux.debug.tag/browser_history.json")

        let prod = BrowserHistoryLocation(applicationSupportDirectory: root, bundleIdentifier: "app.w3dev.cmux")
        #expect(prod.legacyTaggedHistoryFileURL == nil)
    }
}
