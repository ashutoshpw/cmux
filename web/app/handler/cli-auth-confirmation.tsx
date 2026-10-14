"use client";
export type CliAuthIdentityMessages = { email: string; emailUnavailable: string; organization: string; personalAccount: string; switchAccountButton: string; signedOutTitle: string; signedOutBody: string; signInButton: string };
export function CliAuthConfirmation({ identityMessages }: { fullPage?: boolean; identityMessages: CliAuthIdentityMessages }) { return <p>{identityMessages.signedOutBody}</p>; }

export function cliAuthSwitchAccountHref(loginCode: string): string { return `/handler/sign-in?login_code=${encodeURIComponent(loginCode)}`; }
