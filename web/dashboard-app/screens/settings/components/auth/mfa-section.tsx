"use client";
import { authClient, type CurrentUser } from "@/app/lib/stack-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  InlineError,
  SettingsSection,
  settingsButtonClass,
  settingsInputClass,
} from "@/dashboard-app/components/settings-ui";
import { createTOTPKeyURI } from "@oslojs/otp";
/** Retained utility for local QR rendering; enrollment secrets are server-generated. */
export async function totpQrCode(
  issuer: string,
  account: string,
  secret: Uint8Array,
): Promise<string> {
  const QRCode = await import("qrcode");
  return QRCode.toDataURL(createTOTPKeyURI(issuer, account, secret, 30, 6));
}
export function MfaSection({
  user,
}: {
  readonly user: CurrentUser;
  readonly projectName: string;
}) {
  const t = useTranslations("dashboard.settings.auth.mfa");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const response = user.isMultiFactorRequired
        ? await authClient.twoFactor.disable({ password: password || undefined })
        : await authClient.twoFactor.enable({ password: password || undefined });
      if (response.error) setError(t("startError"));
      else if (response.data && "totpURI" in response.data) {
        setUri(response.data.totpURI);
        setQr(await (await import("qrcode")).toDataURL(response.data.totpURI));
        setBackupCodes(response.data.backupCodes);
      } else await user.update({});
    } catch {
      setError(t("startError"));
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError(null);
    try {
      const response = await authClient.twoFactor.verifyTotp({ code });
      if (response.error) setError(t("enableError"));
      else {
        setUri(null);
        await user.update({});
      }
    } catch {
      setError(t("enableError"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsSection
      title={t("title")}
      description={
        user.isMultiFactorRequired
          ? t("enabledDescription")
          : t("disabledDescription")
      }
    >
      {user.hasPassword && (
        <input
          type="password"
          autoComplete="current-password"
          aria-label={t("password")}
          className={settingsInputClass}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      )}
      {uri ? (
        <>
          <p className="text-xs">{t("scan")}</p>
          {qr && <img src={qr} width={200} height={200} alt={t("qrAlt")} />}
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            className={settingsInputClass}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            aria-label={t("enterCode")}
          />
          <button
            disabled={busy}
            onClick={() => void verify()}
            className={settingsButtonClass("primary", "sm")}
          >
            {t("enable")}
          </button>
        </>
      ) : (
        <button
          disabled={busy}
          onClick={() => void start()}
          className={settingsButtonClass("secondary", "sm")}
        >
          {user.isMultiFactorRequired ? t("disable") : t("enable")}
        </button>
      )}
      {backupCodes.length > 0 && (
        <pre className="select-all whitespace-pre-wrap">
          {backupCodes.join("\n")}
        </pre>
      )}
      <InlineError message={error} />
    </SettingsSection>
  );
}
