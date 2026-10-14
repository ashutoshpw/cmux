"use client";
import type {
  CurrentUser,
  CurrentUserContactChannel,
} from "@/app/lib/stack-client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  InlineError,
  SettingsSection,
  settingsButtonClass,
} from "@/dashboard-app/components/settings-ui";
import type { SettingsEmail } from "@/dashboard-app/queries/settings";
export async function withEmailChannel(
  user: CurrentUser,
  id: string,
  operation: (channel: CurrentUserContactChannel) => Promise<void>,
) {
  const channel = (await user.listContactChannels()).find(
    (channel) => channel.id === id,
  );
  if (!channel) throw new Error("email_not_found");
  await operation(channel);
}
export function EmailsSection({
  user,
  channels,
}: {
  readonly user: CurrentUser;
  readonly channels: readonly SettingsEmail[];
}) {
  const t = useTranslations("dashboard.settings.auth.emails");
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsSection title={t("title")} description={t("description")}>
      <ul>
        {channels.map((channel) => (
          <li
            key={channel.id}
            className="flex items-center justify-between gap-3"
          >
            <span>{channel.value}</span>
            {!channel.isVerified && (
              <button
                className={settingsButtonClass("secondary", "sm")}
                onClick={() =>
                  void withEmailChannel(user, channel.id, (channel) =>
                    channel.sendVerificationEmail(),
                  ).catch(() => setError(t("actionError")))
                }
              >
                {t("sendVerification")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <InlineError message={error} />
    </SettingsSection>
  );
}
