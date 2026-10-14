public import Foundation

/// Performs OAuth and authenticated API requests without redirecting credentials.
public protocol OAuthHTTPTransport: Sendable {
    /// Sends a request and returns the exact endpoint's HTTP response.
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}
