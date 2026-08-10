"use client";

import { useLocale, useTranslations } from "next-intl";
import type { OrderStatus } from "@/domain/status";
import { CURRENCIES, type CurrencyCode } from "@/domain/money";

/** Presentation-only money formatting; the server remains the source of truth. */
export function formatMoney(
  decimal: string,
  currency: CurrencyCode,
  locale: string,
): string {
  const { exponent } = CURRENCIES[currency];
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(Number(decimal));
}

export function Money({
  amount,
  currency,
}: {
  amount: string;
  currency: CurrencyCode;
}) {
  const locale = useLocale();
  return <span className="tabular-nums">{formatMoney(amount, currency, locale)}</span>;
}

const STATUS_STYLES: Record<OrderStatus, string> = {
  pending: "bg-slate-100 text-slate-700 ring-slate-200",
  partially_paid: "bg-amber-50 text-amber-700 ring-amber-200",
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  overdue: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const t = useTranslations("status");
  return (
    <span
      data-status={status}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {t(status)}
    </span>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {message}
    </p>
  );
}

export const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none";
export const buttonClass =
  "inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-700 disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50";
