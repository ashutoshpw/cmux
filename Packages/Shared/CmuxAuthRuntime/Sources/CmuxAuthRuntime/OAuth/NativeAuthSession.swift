import Foundation
import CMUXAuthCore

/// Server-authoritative identity and organizations for a validated native bearer.
struct NativeAuthSession: Decodable, Sendable {
    struct User: Decodable, Sendable {
        let id: String
        let name: String?
        let email: String?
        let image: String?
        let emailVerified: Bool
        let clientReadOnlyMetadata: Metadata?
        struct Metadata: Decodable, Sendable { let cmuxReviewDemoContent: Bool? }

        var summary: CMUXAuthUser {
            CMUXAuthUser(id: id, primaryEmail: email, displayName: name, profileImageURL: image, demonstrationContentEnabled: clientReadOnlyMetadata?.cmuxReviewDemoContent == true)
        }
    }
    struct Organization: Decodable, Sendable {
        let id: String
        let name: String
        let slug: String
        let role: String
        var team: CMUXAuthTeam { CMUXAuthTeam(id: id, displayName: name) }
    }
    let user: User
    let organizations: [Organization]
    let activeOrganizationId: String?
}
