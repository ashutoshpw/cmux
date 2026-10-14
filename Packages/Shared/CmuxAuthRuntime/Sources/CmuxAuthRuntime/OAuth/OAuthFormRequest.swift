import Foundation

/// Encodes issuer-only token requests using RFC 6749 form parameters.
struct OAuthFormRequest {
    let url: URL
    let parameters: [(String, String)]

    var request: URLRequest {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = parameters.map { "\(encode($0.0))=\(encode($0.1))" }.joined(separator: "&").data(using: .utf8)
        return request
    }
    private func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")) ?? ""
    }
}
