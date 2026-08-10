"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/client-api";
import { useApiErrorMessage } from "./errors";
import { FormError, buttonClass, inputClass } from "./ui";
import { LocaleSwitcher } from "./locale-switcher";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const t = useTranslations("auth");
  const tc = useTranslations("common");
  const router = useRouter();
  const errorMessage = useApiErrorMessage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">{tc("appName")}</h1>
        <LocaleSwitcher />
      </div>
      <form
        onSubmit={submit}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h2 className="text-base font-semibold">
          {mode === "login" ? t("signInTitle") : t("signUpTitle")}
        </h2>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">{t("email")}</span>
          <input
            type="email"
            required
            autoComplete="email"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium text-slate-700">{t("password")}</span>
          <input
            type="password"
            required
            minLength={mode === "signup" ? 8 : 1}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "signup" && (
            <span className="text-xs text-slate-500">{t("passwordHint")}</span>
          )}
        </label>
        <FormError message={error} />
        <button type="submit" disabled={busy} className={`${buttonClass} w-full`}>
          {mode === "login" ? t("signInCta") : t("signUpCta")}
        </button>
        <p className="text-center text-sm text-slate-500">
          {mode === "login" ? (
            <>
              {t("noAccount")}{" "}
              <Link href="/signup" className="font-medium text-slate-900 underline">
                {t("signUpLink")}
              </Link>
            </>
          ) : (
            <>
              {t("haveAccount")}{" "}
              <Link href="/login" className="font-medium text-slate-900 underline">
                {t("signInLink")}
              </Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
