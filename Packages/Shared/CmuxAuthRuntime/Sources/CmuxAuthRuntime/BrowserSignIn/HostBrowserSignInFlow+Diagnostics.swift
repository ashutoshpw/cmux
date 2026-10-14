import Foundation

extension HostBrowserSignInFlow {
    nonisolated func authCallbackState(from url: URL) -> String? {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let oauthStates = items.filter { $0.name == "state" }
        if !oauthStates.isEmpty {
            return oauthStates.count == 1 ? oauthStates[0].value : nil
        }
        return items.first(where: { $0.name == "cmux_auth_state" })?.value
    }

    nonisolated func redactedAuthState(_ state: String) -> String {
        "\(state.prefix(8))..."
    }

    nonisolated func authCallbackSummary(_ url: URL) -> String {
        let scheme = url.scheme ?? "nil"
        let target = url.host ?? url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .map(\.name)
            .joined(separator: ",") ?? ""
        return "scheme=\(scheme) target=\(target.isEmpty ? "nil" : target) queryKeys=\(queryItems.isEmpty ? "none" : queryItems)"
    }

    nonisolated func sessionResultSummary(_ result: HostBrowserAuthSessionResult) -> String {
        switch result {
        case let .callback(url):
            return "result=callback \(authCallbackSummary(url))"
        case let .cancelled(reason):
            return "result=cancelled reason=\(reason)"
        case let .failed(reason):
            return "result=failed reason=\(reason)"
        }
    }
}
