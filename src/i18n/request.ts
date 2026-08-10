import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, type Locale } from "./config";

/**
 * Locale resolution: a plain `locale` cookie set by the language switcher,
 * defaulting to en-US. Cookie-based (instead of /en /es route prefixes) keeps
 * URLs stable; adding a locale is a JSON file plus one entry in config.ts.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const locale: Locale = (LOCALES as readonly string[]).includes(
    cookieLocale ?? "",
  )
    ? (cookieLocale as Locale)
    : DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
  };
});
