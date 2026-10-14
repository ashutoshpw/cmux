"use client";
import type { CurrentUser } from "@/app/lib/stack-client";
import { useTranslations } from "next-intl";
import {
  SettingsSection,
  SettingsNotice,
} from "@/dashboard-app/components/settings-ui";
import type { SettingsEmail } from "@/dashboard-app/queries/settings";
/** Email codes remain available as the verified account recovery method. */
export function OtpSection({
  user,
}: {
  readonly user: CurrentUser;
  readonly channels: readonly SettingsEmail[];
}) {
  const t = useTranslations("dashboard.settings.auth.otp");
  return (
    <SettingsSection title={t("title")} description={t("enabledDescription")}>
      {!user.primaryEmailVerified && (
        <SettingsNotice>{t("needsVerifiedEmail")}</SettingsNotice>
      )}
    </SettingsSection>
  );
}
