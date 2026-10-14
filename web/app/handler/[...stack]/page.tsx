import { betterAuthOptions } from "../../../services/auth/betterAuthOptions";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { preferredLocaleFromAcceptLanguage } from "../../../i18n/accept-language";
import { loadMessages } from "../../../i18n/messages";
import {
  CmuxSignIn,
  OwnedAuthAction,
  type CmuxSignInMessages,
} from "../cmux-sign-in";
export const instant = false;
export default async function AuthPage({
  params,
}: {
  params: Promise<{ stack: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const { stack } = await params;
  const action = stack.length === 1 ? stack[0] : null;
  if (
    !action ||
    ![
      "sign-in",
      "sign-up",
      "sign-out",
      "forgot-password",
      "reset-password",
      "oauth-consent",
    ].includes(action)
  )
    notFound();
  const request = await headers();
  const messages = (
    await loadMessages(
      preferredLocaleFromAcceptLanguage(request.get("accept-language") ?? ""),
    )
  ).cmuxSignIn as CmuxSignInMessages;
  return (
    <Suspense fallback={<p aria-busy="true">{messages.redirecting}</p>}>
      {action === "sign-in" || action === "sign-up" ? (
        <CmuxSignIn
          mode={action}
          messages={messages}
          providers={Object.keys(betterAuthOptions().socialProviders)}
        />
      ) : (
        <OwnedAuthAction action={action} messages={messages} />
      )}
    </Suspense>
  );
}
