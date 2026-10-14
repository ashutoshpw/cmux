import Testing
@testable import cmuxFeature

@Suite
struct MobileKeychainAccessGroupPolicyTests {
    @Test
    func acceptsDevTagAndProductionGroups() {
        #expect(String.cmuxKeychainAccessGroup(from:
            "7WLXT3NR37.app.w3dev.cmux.ios.debug.tflex"
        ) == "7WLXT3NR37.app.w3dev.cmux.ios.debug.tflex")
        #expect(String.cmuxKeychainAccessGroup(from:
            "7WLXT3NR37.app.w3dev.cmux.ios"
        ) == "7WLXT3NR37.app.w3dev.cmux.ios")
    }

    @Test
    func trimsWhitespaceAroundAValidGroup() {
        #expect(String.cmuxKeychainAccessGroup(from:
            " 7WLXT3NR37.app.w3dev.cmux.ios.beta\n"
        ) == "7WLXT3NR37.app.w3dev.cmux.ios.beta")
    }

    @Test
    func rejectsPrefixLessNilAndMalformedValues() {
        #expect(String.cmuxKeychainAccessGroup(from: "app.w3dev.cmux.ios.beta") == nil)
        #expect(String.cmuxKeychainAccessGroup(from: nil) == nil)
        #expect(String.cmuxKeychainAccessGroup(from: "") == nil)
        #expect(String.cmuxKeychainAccessGroup(from: ".app.w3dev.cmux.ios.beta") == nil)
        #expect(String.cmuxKeychainAccessGroup(from:
            "$(AppIdentifierPrefix)app.w3dev.cmux.ios.beta"
        ) == nil)
    }

    @Test
    func rejectsEmptyBundleComponentsAfterTheTeamIdentifier() {
        // An empty interior or trailing component is a bake gone wrong, not a
        // grantable group; it must fall back rather than resolve.
        #expect(String.cmuxKeychainAccessGroup(from: "7WLXT3NR37..dev") == nil)
        #expect(String.cmuxKeychainAccessGroup(from: "7WLXT3NR37.dev.") == nil)
        #expect(String.cmuxKeychainAccessGroup(from:
            "7WLXT3NR37.dev..cmux.app.beta"
        ) == nil)
    }
}
