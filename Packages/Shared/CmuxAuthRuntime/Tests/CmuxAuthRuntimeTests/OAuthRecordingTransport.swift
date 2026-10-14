import Foundation
@testable import CmuxAuthRuntime

actor OAuthRecordingTransport: OAuthHTTPTransport {
    private(set) var requests: [URLRequest] = []
    private var holdTokenRequest: Bool
    private var tokenRequestWaiters: [CheckedContinuation<Void, Never>] = []
    private var responseWaiter: CheckedContinuation<Void, Never>?
    private let tokenStatus: Int
    private let tokenBody: String?
    private let heldAuthorizationCode: String?
    private let codeResponses: [String: String]

    init(holdTokenRequest: Bool = false, tokenStatus: Int = 200, tokenBody: String? = nil,
         heldAuthorizationCode: String? = nil, codeResponses: [String: String] = [:]) {
        self.holdTokenRequest = holdTokenRequest
        self.tokenStatus = tokenStatus
        self.tokenBody = tokenBody
        self.heldAuthorizationCode = heldAuthorizationCode
        self.codeResponses = codeResponses
    }

    func waitForTokenRequest() async {
        if requests.contains(where: { $0.url?.path == "/api/auth/oauth2/token" }) { return }
        await withCheckedContinuation { tokenRequestWaiters.append($0) }
    }
    func releaseTokenRequest() {
        holdTokenRequest = false
        responseWaiter?.resume()
        responseWaiter = nil
    }

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        requests.append(request)
        let form = request.httpBody.flatMap { String(data: $0, encoding: .utf8) }
        let code = form.flatMap { URLComponents(string: "https://form.example/?" + $0)?.queryItems }
            ?.first(where: { $0.name == "code" })?.value
        if request.url?.path == "/api/auth/oauth2/token" {
            let waiters = tokenRequestWaiters
            tokenRequestWaiters = []
            if holdTokenRequest && (heldAuthorizationCode == nil || heldAuthorizationCode == code) {
                await withCheckedContinuation { continuation in
                    responseWaiter = continuation
                    for waiter in waiters { waiter.resume() }
                }
            } else { for waiter in waiters { waiter.resume() } }
        }
        let body: String
        if request.url?.path == "/api/native-auth/session" {
            body = #"{"user":{"id":"user-1","name":"Native User","email":"native@example.com","image":null,"emailVerified":true},"organizations":[{"id":"org-1","name":"Organization","slug":"organization","role":"owner"}],"activeOrganizationId":"org-1","session":{"id":"session-1"}}"#
        } else {
            body = code.flatMap { codeResponses[$0] } ?? tokenBody
                ?? #"{"access_token":"issuer-access","refresh_token":"issuer-refresh","token_type":"Bearer","expires_in":3600}"#
        }
        return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: request.url?.path == "/api/auth/oauth2/token" ? tokenStatus : 200, httpVersion: nil, headerFields: nil)!)
    }
}
