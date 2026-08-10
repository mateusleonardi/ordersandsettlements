"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/client-api";
import type { OrderDto } from "@/lib/orders";
import { ORDER_STATUSES, type OrderStatus } from "@/domain/status";
import {
  Money,
  StatusBadge,
  buttonClass,
  secondaryButtonClass,
} from "./ui";

export function Dashboard() {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const ts = useTranslations("status");
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  const [filter, setFilter] = useState<OrderStatus | "">("");

  useEffect(() => {
    let cancelled = false;
    const query = filter ? `?status=${filter}` : "";
    void api<{ orders: OrderDto[] }>(`/api/orders${query}`).then(({ orders }) => {
      if (!cancelled) setOrders(orders);
    });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            {t("filterLabel")}
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value as OrderStatus | "")}
            >
              <option value="">{t("all")}</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ts(s)}
                </option>
              ))}
            </select>
          </label>
          {/* Plain anchor on purpose: this is a file download, not a page navigation. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/orders/export" className={secondaryButtonClass}>
            {t("exportCsv")}
          </a>
          <Link href="/orders/new" className={buttonClass}>
            {t("newOrder")}
          </Link>
        </div>
      </div>

      {orders === null ? (
        <p className="text-sm text-slate-500">{tc("loading")}</p>
      ) : orders.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
          {filter ? t("emptyFiltered") : t("empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{t("customer")}</th>
                <th className="px-4 py-3">{t("status")}</th>
                <th className="px-4 py-3 text-right">{t("total")}</th>
                <th className="px-4 py-3 text-right">{t("paid")}</th>
                <th className="px-4 py-3 text-right">{t("due")}</th>
                <th className="px-4 py-3">{t("dueDate")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">
                    <Link
                      href={`/orders/${order.id}`}
                      className="text-slate-900 underline-offset-2 hover:underline"
                    >
                      {order.customer}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={order.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={order.total} currency={order.currency} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Money amount={order.amountPaid} currency={order.currency} />
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    <Money amount={order.amountDue} currency={order.currency} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{order.dueDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
