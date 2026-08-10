"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  type Locale,
} from "@/i18n/config";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function change(next: string) {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <select
      aria-label="Language"
      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"
      value={locale}
      disabled={isPending}
      onChange={(e) => change(e.target.value)}
    >
      {LOCALES.map((code: Locale) => (
        <option key={code} value={code}>
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  );
}
