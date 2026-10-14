public import Foundation

/// An ephemeral URLSession transport with redirects and cookie persistence disabled.
public struct URLSessionOAuthTransport: OAuthHTTPTransport {
    private let session: URLSession

    /// Creates the production transport with no ambient browser session.
    public init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 30
        session = URLSession(configuration: configuration, delegate: OAuthRedirectRejectingDelegate(), delegateQueue: nil)
    }

    public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.url == request.url else { throw AuthError.networkError }
        return (data, http)
    }
}
