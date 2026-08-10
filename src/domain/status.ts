/**
 * Order status is always derived, never stored. Deriving from
 * (total, net paid, due date, now) means status can never drift out of sync
 * with payments, and "overdue" flips automatically as time passes without a
 * background job.
 *
 * Rules (documented in the README):
 * - `paid` wins over `overdue`: an order that was overdue and is then fully
 *   settled shows as `paid`.
 * - An order becomes `overdue` starting the day AFTER its due date, in UTC.
 *   Payment is expected ON the due date, so the due date itself is not late.
 * - Refunds reduce net paid, so a fully refunded `paid` order can regress to
 *   `partially_paid`, `pending` or `overdue`. The audit log preserves history.
 */
export const ORDER_STATUSES = [
  "pending",
  "partially_paid",
  "paid",
  "overdue",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

/** `dueDate` is a calendar date string (YYYY-MM-DD); comparison is in UTC. */
export function isOverdue(dueDate: string, now: Date): boolean {
  const todayUtc = now.toISOString().slice(0, 10);
  return todayUtc > dueDate;
}

export function deriveStatus(args: {
  totalMinor: number;
  netPaidMinor: number;
  dueDate: string;
  now: Date;
}): OrderStatus {
  const { totalMinor, netPaidMinor, dueDate, now } = args;
  if (netPaidMinor >= totalMinor) return "paid";
  if (isOverdue(dueDate, now)) return "overdue";
  if (netPaidMinor > 0) return "partially_paid";
  return "pending";
}
