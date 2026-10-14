import CMUXMobileCore
import CmuxAuthRuntime
import CmuxMobileSupport
import SwiftUI

/// Offers the issuer's hosted sign-in through the system authentication browser.
struct SignInView: View {
    private let usesStandaloneChrome: Bool
    @Environment(AuthCoordinator.self) private var authManager
    @Environment(\.analytics) private var analytics
    @Environment(\.mobileDiagnosticLog) private var diagnosticLog
    @State private var error: String?
    @State private var isSigningIn = false
    private let errorPresentation = SignInErrorPresentation()

    init(usesStandaloneChrome: Bool = true) {
        self.usesStandaloneChrome = usesStandaloneChrome
    }

    var body: some View {
        if usesStandaloneChrome {
            NavigationStack {
                ZStack {
                    GameOfLifeHeader().ignoresSafeArea()
                    VStack {
                        Spacer(minLength: 0)
                        signInCard
                    }
                }
                .mobileInlineNavigationTitle()
            }
        } else {
            ScrollView { signInCard.padding(.vertical, 8) }
        }
    }

    private var signInCard: some View {
        VStack(spacing: 20) {
            HStack(spacing: 10) {
                Image("CmuxSignInMark")
                    .resizable()
                    .renderingMode(.original)
                    .scaledToFit()
                    .frame(width: 28, height: 28)
                    .accessibilityHidden(true)
                Text(L10n.string("mobile.signIn.title", defaultValue: "cmux"))
                    .font(.system(.title2, design: .default, weight: .semibold))
            }
            Text(L10n.string("mobile.signIn.subtitle", defaultValue: "Sign in to connect to your Mac workspaces."))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            SignInAuthRestoreStatusView()
            Button {
                Task { await signIn() }
            } label: {
                Text(L10n.string("mobile.signIn.button", defaultValue: "Sign In"))
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .mobileButtonLoading(isSigningIn, tint: .primary)
            }
            .mobileGlassProminentButton()
            .disabled(isSigningIn || authManager.isLoading || authManager.isRestoringSession)
            .accessibilityIdentifier("signin.browser")
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .accessibilityIdentifier("signin.error")
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 24)
        .padding(.bottom, 20)
        .frame(maxWidth: 430)
        .frame(maxWidth: .infinity)
    }

    private func signIn() async {
        guard !isSigningIn else { return }
        isSigningIn = true
        error = nil
        defer { isSigningIn = false }
        diagnosticLog?.recordAppEvent(.authSignInStarted)
        analytics.capture("ios_sign_in_started", ["method": .string("browser")])
        do {
            try await authManager.signInWithBrowser()
            diagnosticLog?.recordAppEvent(.authSignInSucceeded)
        } catch {
            if error is CancellationError || (error as? AuthError) == .cancelled {
                diagnosticLog?.recordAppEvent(.authSignInCancelled)
                return
            }
            self.error = errorPresentation.message(for: error)
            diagnosticLog?.recordAppEvent(.authSignInFailed, failure: DiagnosticFailureKind.classify(error))
        }
    }
}
