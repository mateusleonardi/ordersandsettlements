"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "@/lib/client-api";
import { LocaleSwitcher } from "./locale-switcher";

export function AppNav({ email }: { email: string }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const router = useRouter();

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
          {tc("appName")}
        </Link>
        <nav className="flex items-center gap-3">
          <Link
            href="/orders/new"
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            {t("newOrder")}
          </Link>
          <LocaleSwitcher />
          <span className="hidden text-xs text-slate-400 sm:inline">{email}</span>
          <button
            type="button"
            onClick={logout}
            className="text-sm font-medium text-slate-600 hover:text-slate-900"
          >
            {t("logout")}
          </button>
        </nav>
      </div>
    </header>
  );
}
