export const LOCALES = ["en-US", "es-ES"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en-US";
export const LOCALE_COOKIE = "locale";

export const LOCALE_LABELS: Record<Locale, string> = {
  "en-US": "English",
  "es-ES": "Español",
};
