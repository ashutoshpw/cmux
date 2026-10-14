"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "../lib/stack-client";
export type CmuxSignInMessages = {
  consentTitle: string;
  consentDescription: string;
  consentScopes: string;
  consentAllow: string;
  consentCancel: string;
  signInTitle: string;
  signInSubtitle: string;
  signUpTitle: string;
  signUpSubtitle: string;
  continueWithProvider: string;
  signInWithPasskey: string;
  orContinueWith: string;
  emailLabel: string;
  emailPlaceholder: string;
  continueWithEmail: string;
  emailCodeTab: string;
  emailPasswordTab: string;
  passwordLabel: string;
  repeatPasswordLabel: string;
  signInButton: string;
  createAccountButton: string;
  forgotPassword: string;
  noAccount: string;
  signUpLink: string;
  haveAccount: string;
  signInLink: string;
  checkEmailTitle: string;
  checkEmailBody: string;
  codeLabel: string;
  back: string;
  resendCode: string;
  chooseAccountTitle: string;
  chooseAccountSubtitle: string;
  useAnotherAccount: string;
  forgetAccount: string;
  signedOut: string;
  signingInAs: string;
  sessionEnded: string;
  redirecting: string;
  lastUsed: string;
  legal: string;
  termsOfService: string;
  privacyPolicy: string;
  signUpDisabled: string;
  noMethods: string;
  embeddedDisabled: string;
  errorInvalidEmail: string;
  errorPasswordRequired: string;
  errorPasswordTooShort: string;
  errorPasswordTooLong: string;
  errorPasswordsDontMatch: string;
  errorWrongPassword: string;
  errorInvalidCode: string;
  errorInvalidTotp: string;
  errorSignUpNotAllowed: string;
  errorPasskey: string;
  errorGeneric: string;
};

function safeReturnTo(): string {
  const target = new URLSearchParams(window.location.search).get(
    "after_auth_return_to",
  );
  return target?.startsWith("/") &&
    !target.startsWith("//") &&
    !target.includes("\\")
    ? target
    : "/handler/after-sign-in";
}
function requiresTwoFactor(data: unknown): boolean {
  return !!data && typeof data === "object" && "twoFactorRedirect" in data && data.twoFactorRedirect === true;
}
function finish(data: unknown) {
  if (
    data &&
    typeof data === "object" &&
    "url" in data &&
    typeof data.url === "string"
  ) {
    window.location.assign(data.url);
    return;
  }
  if (
    data &&
    typeof data === "object" &&
    "redirect_uri" in data &&
    typeof data.redirect_uri === "string"
  ) {
    window.location.assign(data.redirect_uri);
    return;
  }
  window.location.assign(safeReturnTo());
}
function SignInHeading({ mode, messages }: { mode: "sign-in" | "sign-up"; messages: CmuxSignInMessages }) {
  return <>
    <h1 className="mb-2 text-xl font-medium">{mode === "sign-up" ? messages.signUpTitle : messages.signInTitle}</h1>
    <p className="mb-5 text-sm text-muted">{mode === "sign-up" ? messages.signUpSubtitle : messages.signInSubtitle}</p>
  </>;
}
export function CmuxSignIn({
  mode,
  messages,
  providers = [],
}: {
  mode: "sign-in" | "sign-up";
  messages: CmuxSignInMessages;
  providers?: string[];
}) {
  const parameters = useSearchParams();
  const authorizationQuery = parameters.toString();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [method, setMethod] = useState<"email" | "password" | "totp">(parameters.get("mfa") === "required" ? "totp" : "email");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response =
        method === "totp"
          ? await authClient.twoFactor.verifyTotp({ code: otp })
          : method === "password"
            ? mode === "sign-up"
              ? await authClient.signUp.email({
                  email,
                  password,
                  name: email.split("@")[0] ?? "",
                  callbackURL: "/handler/after-sign-in",
                })
              : await authClient.signIn.email({ email, password })
            : sent
              ? await authClient.signIn.emailOtp({ email, otp })
              : await authClient.emailOtp.sendVerificationOtp({
                  email,
                  type: "sign-in",
                });
      if (response.error) {
        setError(messages.errorGeneric);
        return;
      }
      if (method === "email" && !sent) {
        setSent(true);
        return;
      }
      if (requiresTwoFactor(response.data)) {
        setMethod("totp");
        setOtp("");
        return;
      }
      if (mode === "sign-up" && method === "password") {
        const verification = await authClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" });
        if (verification.error) throw new Error("Email code delivery failed");
        setSent(true);
        setMethod("email");
        return;
      }
      finish(response.data);
    } catch {
      setError(messages.errorGeneric);
    } finally {
      setBusy(false);
    }
  }
  async function passkey() {
    setBusy(true);
    setError(null);
    try {
      const response = await authClient.signIn.passkey();
      if (response.error) setError(messages.errorPasskey);
      else if (requiresTwoFactor(response.data)) {
        setMethod("totp");
        setOtp("");
      } else finish(response.data);
    } catch {
      setError(messages.errorPasskey);
    } finally {
      setBusy(false);
    }
  }
  async function signInSocial(provider: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await authClient.signIn.social({ provider, callbackURL: "/handler/after-sign-in" });
      if (response.error) setError(messages.errorGeneric);
    } catch {
      setError(messages.errorGeneric);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="w-full max-w-sm border border-border bg-background p-7 text-foreground">
        <SignInHeading mode={mode} messages={messages} />
        {providers.map((provider) => (
          <button
            key={provider}
            className="mb-3 w-full border border-border px-3 py-2"
            type="button"
            disabled={busy}
            onClick={() => void signInSocial(provider)}
          >
            {messages.continueWithProvider.replace(
              "{provider}",
              provider === "google" ? "Google" : "GitHub",
            )}
          </button>
        ))}
        <form onSubmit={submit} className="grid gap-3" aria-busy={busy}>
          {method !== "totp" && (
            <label className="grid gap-1 text-sm">
              {messages.emailLabel}
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="border border-border bg-background px-3 py-2"
              />
            </label>
          )}
          {method === "password" && (
            <label className="grid gap-1 text-sm">
              {messages.passwordLabel}
              <input
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete={
                  mode === "sign-up" ? "new-password" : "current-password"
                }
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="border border-border bg-background px-3 py-2"
              />
            </label>
          )}
          {(sent || method === "totp") && (
            <label className="grid gap-1 text-sm">
              {messages.codeLabel}
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                className="border border-border bg-background px-3 py-2"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={busy}
            className="bg-foreground px-3 py-2 text-background"
          >
            {busy
              ? messages.redirecting
              : method === "email" && !sent
                ? messages.continueWithEmail
                : mode === "sign-up" && method === "password"
                  ? messages.createAccountButton
                  : messages.signInButton}
          </button>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </form>
        {sent && method === "email" && (
          <p className="mt-3 text-sm text-muted">{messages.checkEmailBody}</p>
        )}
        {method !== "totp" && (
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setMethod(method === "email" ? "password" : "email");
                setSent(false);
              }}
            >
              {method === "email"
                ? messages.emailPasswordTab
                : messages.emailCodeTab}
            </button>
            <button type="button" disabled={busy} onClick={() => void passkey()}>
              {messages.signInWithPasskey}
            </button>
            <Link href="/handler/forgot-password">
              {messages.forgotPassword}
            </Link>
          </div>
        )}
        <p className="mt-5 text-sm">
          <a
            href={`${mode === "sign-up" ? "/handler/sign-in" : "/handler/sign-up"}?${authorizationQuery}`}
          >
            {mode === "sign-up" ? messages.signInLink : messages.signUpLink}
          </a>
        </p>
      </section>
    </main>
  );
}
export function CmuxOAuthCallback({
  messages,
}: {
  messages: CmuxSignInMessages;
}) {
  useEffect(() => {
    window.location.replace("/handler/after-sign-in");
  }, []);
  return <p aria-busy="true">{messages.redirecting}</p>;
}
export function OwnedAuthAction({
  action,
  messages,
}: {
  action: string;
  messages: CmuxSignInMessages;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (action === "sign-out")
      void authClient
        .signOut()
        .then(() => window.location.replace("/handler/sign-in"));
  }, [action]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const token =
      new URLSearchParams(window.location.search).get("token") ?? "";
    const response =
      action === "reset-password"
        ? await authClient.resetPassword({ newPassword: value, token })
        : await authClient.requestPasswordReset({
            email: value,
            redirectTo: `${window.location.origin}/handler/reset-password`,
          });
    if (response.error) setError(messages.errorGeneric);
    else setDone(true);
  }
  if (action === "oauth-consent") return <OAuthConsent messages={messages} />;
  if (action === "sign-out")
    return <p aria-busy="true">{messages.redirecting}</p>;
  return (
    <main className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={submit}
        className="grid w-full max-w-sm gap-3 border border-border p-6"
      >
        <label>
          {action === "reset-password"
            ? messages.passwordLabel
            : messages.emailLabel}
          <input
            required
            type={action === "reset-password" ? "password" : "email"}
            minLength={action === "reset-password" ? 12 : undefined}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-2 w-full border border-border bg-background px-3 py-2"
          />
        </label>
        <button type="submit" className="border border-border p-2">
          {messages.continueWithEmail}
        </button>
        {error && <p role="alert">{error}</p>}
        {done && <p>{messages.checkEmailBody}</p>}
      </form>
    </main>
  );
}
function OAuthConsent({ messages }: { messages: CmuxSignInMessages }) {
  const [error, setError] = useState(false);
  const query =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const client = query.get("client_id");
  const application =
    client === "cmux-w3dev-ios"
      ? "cmux W3Dev for iOS"
      : client === "cmux-w3dev-macos"
        ? "cmux W3Dev for macOS"
        : "cmux W3Dev";
  const requestedScopes = (
    query.get("scope") ?? "openid profile email cmux:api"
  )
    .split(" ")
    .filter(Boolean);
  async function consent(accept: boolean) {
    const response = await authClient.$fetch<{ redirect_uri: string }>(
      "/oauth2/consent",
      { method: "POST", body: { accept } },
    );
    if (response.error || !response.data) setError(true);
    else window.location.assign(response.data.redirect_uri);
  }
  return (
    <main className="flex min-h-screen items-center justify-center">
      <section className="max-w-sm border border-border p-6">
        <h1 className="text-lg">{messages.consentTitle}</h1>
        <p className="my-3">
          {messages.consentDescription.replace("{application}", application)}
        </p>
        <p>{messages.consentScopes}</p>
        <ul className="mb-4 list-inside list-disc">
          {requestedScopes.map((scope) => (
            <li key={scope}>{scope}</li>
          ))}
        </ul>
        <button
          className="border border-border p-2"
          onClick={() => void consent(true)}
        >
          {messages.consentAllow}
        </button>
        <button
          className="ml-3 border border-border p-2"
          onClick={() => void consent(false)}
        >
          {messages.consentCancel}
        </button>
        {error && <p role="alert">{messages.errorGeneric}</p>}
      </section>
    </main>
  );
}
