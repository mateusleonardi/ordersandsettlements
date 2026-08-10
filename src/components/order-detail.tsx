"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ApiError, api } from "@/lib/client-api";
import type { AuditDto, OrderDto, PaymentDto } from "@/lib/orders";
import { useApiErrorMessage } from "./errors";
import {
  FormError,
  Money,
  StatusBadge,
  buttonClass,
  dangerButtonClass,
  inputClass,
  secondaryButtonClass,
} from "./ui";

interface Detail {
  order: OrderDto;
  payments: PaymentDto[];
  auditLog: AuditDto[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function OrderDetail({ orderId }: { orderId: string }) {
  const t = useTranslations("orderDetail");
  const tc = useTranslations("common");
  const ta = useTranslations("audit");
  const ts = useTranslations("status");
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useApiErrorMessage();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useState<"payment" | "refund">("payment");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One idempotency key per payment "intent": retries of the same submit
  // reuse the key (the API dedupes); a success rotates it for the next entry.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    api<Detail>(`/api/orders/${orderId}`)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === "UNAUTHORIZED") {
          router.push("/login");
          return;
        }
        setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
    // errorMessage/router are stable enough; refetch on id/refresh change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, refreshKey]);

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api(`/api/orders/${orderId}/${mode}s`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({
          amount: amount.trim(),
          date,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      idempotencyKey.current = crypto.randomUUID();
      setAmount("");
      setNote("");
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(t("confirmDelete"))) return;
    try {
      await api(`/api/orders/${orderId}`, { method: "DELETE" });
      router.push("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!detail) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <FormError message={error} />
        {!error && <p className="text-sm text-slate-500">{tc("loading")}</p>}
      </main>
    );
  }

  const { order, payments, auditLog } = detail;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/dashboard"
            className="text-sm text-slate-500 underline-offset-2 hover:underline"
          >
            ← {t("back")}
          </Link>
          <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold tracking-tight">
            {order.customer}
            <StatusBadge status={order.status} />
          </h1>
        </div>
        {order.editable ? (
          <button type="button" onClick={remove} className={dangerButtonClass}>
            {t("deleteOrder")}
          </button>
        ) : (
          <p className="text-xs text-slate-500">{t("readOnly")}</p>
        )}
      </div>

      <section className="grid gap-4 sm:grid-cols-4">
        {(
          [
            ["total", order.total],
            ["amountPaid", order.amountPaid],
            ["amountDue", order.amountDue],
          ] as const
        ).map(([key, value]) => (
          <div
            key={key}
            className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {t(key)}
            </p>
            <p className="mt-1 text-lg font-semibold" data-field={key}>
              <Money amount={value} currency={order.currency} />
            </p>
          </div>
        ))}
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {t("date")}
          </p>
          <p className="mt-1 text-lg font-semibold">{order.dueDate}</p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
          {t("lineItems")}
        </h2>
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <tbody className="divide-y divide-slate-100">
            {order.lineItems.map((li, i) => (
              <tr key={i}>
                <td className="px-4 py-2">{li.description}</td>
                <td className="px-4 py-2 text-right text-slate-500">
                  {li.quantity} ×{" "}
                  <Money amount={li.unitPrice} currency={order.currency} />
                </td>
                <td className="px-4 py-2 text-right font-medium">
                  <Money amount={li.lineTotal} currency={order.currency} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode("payment")}
              className={mode === "payment" ? buttonClass : secondaryButtonClass}
            >
              {t("recordPayment")}
            </button>
            <button
              type="button"
              onClick={() => setMode("refund")}
              className={mode === "refund" ? buttonClass : secondaryButtonClass}
            >
              {t("recordRefund")}
            </button>
          </div>
          <form onSubmit={submitEntry} className="space-y-3">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">
                {t("amount")} ({order.currency})
              </span>
              <input
                required
                inputMode="decimal"
                placeholder="0.00"
                className={inputClass}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">{t("date")}</span>
              <input
                type="date"
                required
                className={inputClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-sm font-medium text-slate-700">{t("note")}</span>
              <input
                maxLength={500}
                className={inputClass}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <FormError message={error} />
            <button type="submit" disabled={busy} className={`${buttonClass} w-full`}>
              {busy
                ? t("submitting")
                : mode === "payment"
                  ? t("recordPayment")
                  : t("recordRefund")}
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">{t("payments")}</h2>
          {payments.length === 0 ? (
            <p className="text-sm text-slate-500">{t("noPayments")}</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="font-medium">
                      {p.type === "payment" ? t("payment") : t("refund")}
                      <span className="ml-2 text-xs text-slate-400">{p.date}</span>
                    </p>
                    {p.note && <p className="text-xs text-slate-500">{p.note}</p>}
                  </div>
                  <span
                    className={
                      p.type === "refund"
                        ? "font-medium text-red-600"
                        : "font-medium text-emerald-700"
                    }
                  >
                    {p.type === "refund" ? "−" : "+"}
                    <Money amount={p.amount} currency={p.currency} />
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mb-2 mt-6 text-sm font-semibold">{t("audit")}</h2>
          <ul className="space-y-1 text-xs text-slate-500">
            {auditLog.map((entry) => (
              <li key={entry.id}>
                <span className="font-medium text-slate-700">
                  {ta(entry.event)}
                </span>
                {entry.statusBefore &&
                  entry.statusAfter &&
                  entry.statusBefore !== entry.statusAfter && (
                    <span>
                      {" "}
                      ({ts(entry.statusBefore as never)} →{" "}
                      {ts(entry.statusAfter as never)})
                    </span>
                  )}
                <span className="ml-1 text-slate-400">
                  {new Date(entry.createdAt).toLocaleString(locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
