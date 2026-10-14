import { createTranslator } from "next-intl";
import { locales, type Locale } from "../../i18n/routing";

type MailKind = "reset" | "verify" | "otp" | "invite" | "magic";
type TemplateValues = { url?: string; otp?: string; organization?: string };

/** Select a supported requested language while retaining English for unknown locales. */
function mailLocale(request?: Request): Locale {
  const requested = (request?.headers.get("accept-language") ?? "").slice(0, 1024).split(",").map(value => {
    const [language, ...parameters] = value.split(";");
    const weight = parameters.find(parameter => parameter.trim().startsWith("q="));
    return { language: language!.trim().toLowerCase(), quality: weight ? Number(weight.trim().slice(2)) : 1 };
  }).filter(value => value.quality > 0 && value.quality <= 1).sort((a, b) => b.quality - a.quality);
  for (const { language } of requested) {
    const exact = locales.find(locale => locale.toLowerCase() === language);
    if (exact) return exact;
    const base = locales.find(locale => locale.toLowerCase() === language.split("-")[0]);
    if (base) return base;
  }
  return "en";
}

/** Auth mail shares the web translation catalogs and interpolates only plain text. */
export async function betterAuthMailTemplate(kind: MailKind, values: TemplateValues, request?: Request) {
  const locale = mailLocale(request);
  const messages = (await import(`../../messages/${locale}.json`)).default;
  const translate = createTranslator({ locale, messages, namespace: "authMail" });
  const parameters = { ...values, organization: values.organization?.replace(/[\p{Cc}\p{Cf}]/gu, " ").slice(0, 120) ?? "cmux" };
  return { subject: translate(`${kind}Subject`, parameters), text: translate(`${kind}Body`, parameters) };
}
