"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@/lib/client-api";
import type { OrderDto } from "@/lib/orders";
import {
  CURRENCY_CODES,
  minorToDecimal,
  parseAmount,
  type CurrencyCode,
} from "@/domain/money";
import { useApiErrorMessage } from "./errors";
import {
  FormError,
  buttonClass,
  formatMoney,
  inputClass,
  secondaryButtonClass,
} from "./ui";

interface LineDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

const EMPTY_LINE: LineDraft = { description: "", quantity: "1", unitPrice: "" };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function OrderForm() {
  const t = useTranslations("orderForm");
  const locale = useLocale();
  const router = useRouter();
  const errorMessage = useApiErrorMessage();
  const [customer, setCustomer] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("USD");
  const [dueDate, setDueDate] = useState(today());
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per creation intent: retries of the same submit reuse it, so a
  // double click or network retry cannot create two orders.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  function setLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );
  }

  // Display-only preview; the server recomputes and is the source of truth.
  const previewTotal = useMemo(() => {
    try {
      const totalMinor = lines.reduce((sum, line) => {
        const qty = Number(line.quantity);
        if (!Number.isInteger(qty) || qty < 1) throw new Error("invalid");
        return sum + qty * parseAmount(line.unitPrice, currency);
      }, 0);
      return formatMoney(minorToDecimal(totalMinor, currency), currency, locale);
    } catch {
      return null;
    }
  }, [lines, currency, locale]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { order } = await api<{ order: OrderDto }>("/api/orders", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey.current },
        body: JSON.stringify({
          customer,
          currency,
          dueDate,
          lineItems: lines.map((line) => ({
            description: line.description,
            quantity: Number(line.quantity),
            unitPrice: line.unitPrice.trim(),
          })),
        }),
      });
      router.push(`/orders/${order.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">{t("title")}</h1>
      <form
        onSubmit={submit}
        className="space-y-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">
              {t("customer")}
            </span>
            <input
              required
              maxLength={200}
              className={inputClass}
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">
              {t("currency")}
            </span>
            <select
              className={inputClass}
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
            >
              {CURRENCY_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-slate-700">
              {t("dueDate")}
            </span>
            <input
              type="date"
              required
              className={inputClass}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-slate-700">
            {t("lineItems")}
          </legend>
          {lines.map((line, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <label className="min-w-40 flex-1 space-y-1">
                <span className="text-xs text-slate-500">{t("description")}</span>
                <input
                  required
                  maxLength={200}
                  className={inputClass}
                  value={line.description}
                  onChange={(e) => setLine(i, { description: e.target.value })}
                />
              </label>
              <label className="w-20 space-y-1">
                <span className="text-xs text-slate-500">{t("quantity")}</span>
                <input
                  type="number"
                  required
                  min={1}
                  step={1}
                  className={inputClass}
                  value={line.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                />
              </label>
              <label className="w-32 space-y-1">
                <span className="text-xs text-slate-500">{t("unitPrice")}</span>
                <input
                  required
                  inputMode="decimal"
                  placeholder="0.00"
                  className={inputClass}
                  value={line.unitPrice}
                  onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                />
              </label>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={lines.length === 1}
                onClick={() =>
                  setLines((prev) => prev.filter((_, idx) => idx !== i))
                }
              >
                {t("remove")}
              </button>
            </div>
          ))}
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
          >
            {t("addLine")}
          </button>
        </fieldset>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-600">
            {t("previewTotal")}:{" "}
            <span className="font-semibold text-slate-900">
              {previewTotal ?? "–"}
            </span>
          </p>
          <FormError message={error} />
          <button type="submit" disabled={busy} className={buttonClass}>
            {busy ? t("creating") : t("create")}
          </button>
        </div>
      </form>
    </main>
  );
}
