import { ClientSession, ObjectId } from "mongodb";
import { DomainError, notFound } from "../domain/errors";
import {
  minorToDecimal,
  parseAmount,
  type CurrencyCode,
} from "../domain/money";
import { deriveStatus, type OrderStatus } from "../domain/status";
import type {
  CreateOrderInput,
  PaymentInput,
  UpdateOrderInput,
} from "../domain/schemas";
import {
  getMongo,
  type AuditDoc,
  type LineItemDoc,
  type OrderDoc,
  type PaymentDoc,
  type UserDoc,
} from "./db";

/**
 * Order/payment service. All functions are tenant-scoped: every query filters
 * by userId, so a user can never read or mutate another user's data (missing
 * or foreign ids both surface as 404).
 */

// ---------------------------------------------------------------------------
// DTOs (what the API returns; all amounts as decimal strings)

export interface OrderDto {
  id: string;
  customer: string;
  currency: CurrencyCode;
  dueDate: string;
  status: OrderStatus;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
  }>;
  subtotal: string;
  total: string;
  amountPaid: string;
  amountDue: string;
  paymentCount: number;
  editable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentDto {
  id: string;
  type: "payment" | "refund";
  amount: string;
  currency: CurrencyCode;
  date: string;
  note?: string;
  createdAt: string;
}

export interface AuditDto {
  id: string;
  event: AuditDoc["event"];
  statusBefore?: string;
  statusAfter?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export function orderToDto(order: OrderDoc, now = new Date()): OrderDto {
  const c = order.currency;
  return {
    id: order._id.toHexString(),
    customer: order.customer,
    currency: c,
    dueDate: order.dueDate,
    status: deriveStatus({
      totalMinor: order.totalMinor,
      netPaidMinor: order.netPaidMinor,
      dueDate: order.dueDate,
      now,
    }),
    lineItems: order.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: minorToDecimal(li.unitPriceMinor, c),
      lineTotal: minorToDecimal(li.lineTotalMinor, c),
    })),
    subtotal: minorToDecimal(order.subtotalMinor, c),
    total: minorToDecimal(order.totalMinor, c),
    amountPaid: minorToDecimal(order.netPaidMinor, c),
    amountDue: minorToDecimal(order.totalMinor - order.netPaidMinor, c),
    paymentCount: order.paymentCount,
    editable: order.paymentCount === 0,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export function paymentToDto(payment: PaymentDoc): PaymentDto {
  return {
    id: payment._id.toHexString(),
    type: payment.type,
    amount: minorToDecimal(payment.amountMinor, payment.currency),
    currency: payment.currency,
    date: payment.date,
    note: payment.note,
    createdAt: payment.createdAt.toISOString(),
  };
}

export function auditToDto(entry: AuditDoc): AuditDto {
  return {
    id: entry._id.toHexString(),
    event: entry.event,
    statusBefore: entry.statusBefore,
    statusAfter: entry.statusAfter,
    data: entry.data,
    createdAt: entry.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers

function buildLineItems(
  input: CreateOrderInput["lineItems"],
  currency: CurrencyCode,
): { lineItems: LineItemDoc[]; subtotalMinor: number } {
  const lineItems = input.map((li) => {
    const unitPriceMinor = parseAmount(li.unitPrice, currency);
    return {
      description: li.description,
      quantity: li.quantity,
      unitPriceMinor,
      lineTotalMinor: li.quantity * unitPriceMinor,
    };
  });
  const subtotalMinor = lineItems.reduce((sum, li) => sum + li.lineTotalMinor, 0);
  if (subtotalMinor <= 0) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Order total must be greater than zero",
      400,
    );
  }
  if (!Number.isSafeInteger(subtotalMinor)) {
    throw new DomainError("VALIDATION_ERROR", "Order total is too large", 400);
  }
  return { lineItems, subtotalMinor };
}

function parseOrderId(id: string): ObjectId {
  if (!ObjectId.isValid(id)) throw notFound("Order");
  return new ObjectId(id);
}

function statusOf(order: OrderDoc, now: Date): OrderStatus {
  return deriveStatus({
    totalMinor: order.totalMinor,
    netPaidMinor: order.netPaidMinor,
    dueDate: order.dueDate,
    now,
  });
}

async function insertAudit(
  entry: Omit<AuditDoc, "_id" | "createdAt">,
  session?: ClientSession,
): Promise<void> {
  const { collections } = await getMongo();
  await collections.auditLogs.insertOne(
    { ...entry, _id: new ObjectId(), createdAt: new Date() },
    { session },
  );
}

// ---------------------------------------------------------------------------
// Orders CRUD

export async function createOrder(
  user: UserDoc,
  input: CreateOrderInput,
): Promise<OrderDto> {
  const { collections } = await getMongo();
  const currency = input.currency as CurrencyCode;
  const { lineItems, subtotalMinor } = buildLineItems(input.lineItems, currency);
  const now = new Date();
  const order: OrderDoc = {
    _id: new ObjectId(),
    userId: user._id,
    customer: input.customer,
    currency,
    dueDate: input.dueDate,
    lineItems,
    subtotalMinor,
    // No order-level tax or discount in this assignment: total == subtotal.
    totalMinor: subtotalMinor,
    netPaidMinor: 0,
    paymentCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await collections.orders.insertOne(order);
  await insertAudit({
    userId: user._id,
    orderId: order._id,
    event: "order_created",
    statusAfter: statusOf(order, now),
    data: { total: minorToDecimal(subtotalMinor, currency), currency },
  });
  return orderToDto(order, now);
}

export async function listOrders(
  user: UserDoc,
  statusFilter?: OrderStatus,
): Promise<OrderDto[]> {
  const { collections } = await getMongo();
  const now = new Date();
  const orders = await collections.orders
    .find({ userId: user._id })
    .sort({ createdAt: -1 })
    .toArray();
  const dtos = orders.map((o) => orderToDto(o, now));
  // Status is derived (overdue depends on "now"), so filtering happens after
  // derivation. At scale this would become a computed query on
  // (netPaidMinor, totalMinor, dueDate); see README.
  return statusFilter ? dtos.filter((o) => o.status === statusFilter) : dtos;
}

export async function getOrderDetail(
  user: UserDoc,
  id: string,
): Promise<{ order: OrderDto; payments: PaymentDto[]; auditLog: AuditDto[] }> {
  const { collections } = await getMongo();
  const orderId = parseOrderId(id);
  const order = await collections.orders.findOne({
    _id: orderId,
    userId: user._id,
  });
  if (!order) throw notFound("Order");
  const [payments, auditLog] = await Promise.all([
    collections.payments
      .find({ orderId, userId: user._id })
      .sort({ createdAt: 1 })
      .toArray(),
    collections.auditLogs
      .find({ orderId, userId: user._id })
      .sort({ createdAt: 1 })
      .toArray(),
  ]);
  return {
    order: orderToDto(order),
    payments: payments.map(paymentToDto),
    auditLog: auditLog.map(auditToDto),
  };
}

/**
 * Orders are editable only while no payments or refunds exist. Once money is
 * involved the document is immutable (corrections happen via refunds), so the
 * over-payment invariant can never be broken by shrinking the total.
 */
export async function updateOrder(
  user: UserDoc,
  id: string,
  input: UpdateOrderInput,
): Promise<OrderDto> {
  const { collections } = await getMongo();
  const orderId = parseOrderId(id);
  const existing = await collections.orders.findOne({
    _id: orderId,
    userId: user._id,
  });
  if (!existing) throw notFound("Order");
  if (existing.paymentCount > 0) {
    throw new DomainError(
      "ORDER_NOT_EDITABLE",
      "This order has payments recorded and can no longer be edited",
      409,
      { paymentCount: existing.paymentCount },
    );
  }

  const update: Partial<OrderDoc> = { updatedAt: new Date() };
  if (input.customer !== undefined) update.customer = input.customer;
  if (input.dueDate !== undefined) update.dueDate = input.dueDate;
  if (input.lineItems !== undefined) {
    const { lineItems, subtotalMinor } = buildLineItems(
      input.lineItems,
      existing.currency,
    );
    update.lineItems = lineItems;
    update.subtotalMinor = subtotalMinor;
    update.totalMinor = subtotalMinor;
  }

  // paymentCount in the filter re-checks editability atomically: a payment
  // landing between the read above and this write cannot be overwritten.
  const updated = await collections.orders.findOneAndUpdate(
    { _id: orderId, userId: user._id, paymentCount: 0 },
    { $set: update },
    { returnDocument: "after" },
  );
  if (!updated) {
    throw new DomainError(
      "ORDER_NOT_EDITABLE",
      "This order has payments recorded and can no longer be edited",
      409,
    );
  }
  await insertAudit({
    userId: user._id,
    orderId,
    event: "order_updated",
    data: { fields: Object.keys(input) },
  });
  return orderToDto(updated);
}

export async function deleteOrder(user: UserDoc, id: string): Promise<void> {
  const { collections } = await getMongo();
  const orderId = parseOrderId(id);
  const existing = await collections.orders.findOne({
    _id: orderId,
    userId: user._id,
  });
  if (!existing) throw notFound("Order");
  if (existing.paymentCount > 0) {
    throw new DomainError(
      "ORDER_NOT_EDITABLE",
      "This order has payments recorded and cannot be deleted",
      409,
      { paymentCount: existing.paymentCount },
    );
  }
  const result = await collections.orders.deleteOne({
    _id: orderId,
    userId: user._id,
    paymentCount: 0,
  });
  if (result.deletedCount === 0) {
    throw new DomainError(
      "ORDER_NOT_EDITABLE",
      "This order has payments recorded and cannot be deleted",
      409,
    );
  }
  await insertAudit({
    userId: user._id,
    orderId,
    event: "order_deleted",
    data: { customer: existing.customer },
  });
}

// ---------------------------------------------------------------------------
// Payments and refunds

export interface RecordPaymentResult {
  order: OrderDto;
  payment: PaymentDto;
  /** True when an Idempotency-Key replay returned the original payment. */
  idempotent: boolean;
}

export async function recordPayment(
  user: UserDoc,
  orderId: string,
  input: PaymentInput,
  idempotencyKey?: string,
): Promise<RecordPaymentResult> {
  return recordEntry(user, orderId, input, "payment", idempotencyKey);
}

export async function recordRefund(
  user: UserDoc,
  orderId: string,
  input: PaymentInput,
  idempotencyKey?: string,
): Promise<RecordPaymentResult> {
  return recordEntry(user, orderId, input, "refund", idempotencyKey);
}

/**
 * Records a payment or refund atomically.
 *
 * Concurrency: the write is a conditional findOneAndUpdate whose filter
 * enforces the invariant (payments: netPaid + amount <= total; refunds:
 * netPaid - amount >= 0) while incrementing netPaidMinor. Two concurrent
 * requests both pass validation, but Mongo serializes the document update, so
 * the second conditional update simply matches nothing and is rejected with
 * the recalculated maximum. A multi-document transaction keeps the order
 * update, the payment insert and the audit entry consistent.
 *
 * Idempotency: an optional Idempotency-Key header dedupes retries (double
 * click, network retry). A replay returns HTTP 200 with the original payment
 * instead of creating a second one; a unique partial index backs this against
 * races, and duplicate-key errors are resolved by returning the winner.
 */
async function recordEntry(
  user: UserDoc,
  orderIdRaw: string,
  input: PaymentInput,
  type: "payment" | "refund",
  idempotencyKey?: string,
): Promise<RecordPaymentResult> {
  const { client, collections } = await getMongo();
  const orderId = parseOrderId(orderIdRaw);

  const order = await collections.orders.findOne({
    _id: orderId,
    userId: user._id,
  });
  if (!order) throw notFound("Order");

  const amountMinor = parseAmount(input.amount, order.currency);
  if (amountMinor <= 0) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "Amount must be at least 0.01",
      400,
    );
  }

  if (idempotencyKey) {
    const existing = await findByIdempotencyKey(
      collections,
      orderId,
      idempotencyKey,
    );
    if (existing) return existing;
  }

  const now = new Date();
  const statusBefore = statusOf(order, now);
  const payment: PaymentDoc = {
    _id: new ObjectId(),
    orderId,
    userId: user._id,
    type,
    amountMinor,
    currency: order.currency,
    date: input.date,
    ...(input.note ? { note: input.note } : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
    createdAt: now,
  };

  const delta = type === "payment" ? amountMinor : -amountMinor;
  // Guard: 0 <= netPaid + delta <= total, enforced inside the filter.
  const guard =
    type === "payment"
      ? { $lte: [{ $add: ["$netPaidMinor", amountMinor] }, "$totalMinor"] }
      : { $gte: [{ $subtract: ["$netPaidMinor", amountMinor] }, 0] };

  let updatedOrder: OrderDoc | null = null;
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      updatedOrder = await collections.orders.findOneAndUpdate(
        { _id: orderId, userId: user._id, $expr: guard },
        {
          $inc: { netPaidMinor: delta, paymentCount: 1 },
          $set: { updatedAt: now },
        },
        { returnDocument: "after", session },
      );
      if (!updatedOrder) {
        // Guard failed (over-payment or lost a concurrent race). Nothing was
        // written, so returning lets the empty transaction commit as a no-op;
        // the caller turns this into a 409 with the recalculated maximum.
        return;
      }
      await collections.payments.insertOne(payment, { session });
      const statusAfter = statusOf(updatedOrder, now);
      await insertAudit(
        {
          userId: user._id,
          orderId,
          event: type === "payment" ? "payment_recorded" : "refund_recorded",
          statusBefore,
          statusAfter,
          data: {
            amount: minorToDecimal(amountMinor, order.currency),
            currency: order.currency,
            date: input.date,
          },
        },
        session,
      );
    });
  } catch (err) {
    if (isDuplicateKey(err) && idempotencyKey) {
      // Lost an idempotency race: another request with the same key won.
      const existing = await findByIdempotencyKey(
        collections,
        orderId,
        idempotencyKey,
      );
      if (existing) return existing;
    }
    throw err;
  } finally {
    await session.endSession();
  }

  if (!updatedOrder) {
    // Re-read for an accurate, actionable error message.
    const current = await collections.orders.findOne({
      _id: orderId,
      userId: user._id,
    });
    if (!current) throw notFound("Order");
    if (type === "payment") {
      const maxAllowed = current.totalMinor - current.netPaidMinor;
      throw new DomainError(
        "OVERPAYMENT",
        maxAllowed <= 0
          ? "This order is already fully paid"
          : `Payment exceeds the amount due. Maximum allowed: ${minorToDecimal(maxAllowed, current.currency)} ${current.currency}`,
        409,
        {
          maxAllowed: minorToDecimal(Math.max(maxAllowed, 0), current.currency),
          currency: current.currency,
        },
      );
    }
    const maxRefundable = current.netPaidMinor;
    throw new DomainError(
      "REFUND_EXCEEDS_PAID",
      maxRefundable <= 0
        ? "There are no payments to refund on this order"
        : `Refund exceeds the net amount paid. Maximum refundable: ${minorToDecimal(maxRefundable, current.currency)} ${current.currency}`,
      409,
      {
        maxRefundable: minorToDecimal(
          Math.max(maxRefundable, 0),
          current.currency,
        ),
        currency: current.currency,
      },
    );
  }

  return {
    order: orderToDto(updatedOrder, now),
    payment: paymentToDto(payment),
    idempotent: false,
  };
}

async function findByIdempotencyKey(
  collections: Awaited<ReturnType<typeof getMongo>>["collections"],
  orderId: ObjectId,
  idempotencyKey: string,
): Promise<RecordPaymentResult | null> {
  const existing = await collections.payments.findOne({
    orderId,
    idempotencyKey,
  });
  if (!existing) return null;
  const order = await collections.orders.findOne({ _id: orderId });
  if (!order) return null;
  return {
    order: orderToDto(order),
    payment: paymentToDto(existing),
    idempotent: true,
  };
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === 11000
  );
}

// ---------------------------------------------------------------------------
// CSV export

const CSV_HEADER = [
  "order_id",
  "customer",
  "currency",
  "due_date",
  "status",
  "total",
  "amount_paid",
  "amount_due",
  "created_at",
].join(",");

export async function exportOrdersCsv(
  user: UserDoc,
  range: { from?: string; to?: string },
): Promise<string> {
  const { collections } = await getMongo();
  const now = new Date();
  const dueDateFilter: Record<string, string> = {};
  if (range.from) dueDateFilter.$gte = range.from;
  if (range.to) dueDateFilter.$lte = range.to;
  const orders = await collections.orders
    .find({
      userId: user._id,
      ...(Object.keys(dueDateFilter).length ? { dueDate: dueDateFilter } : {}),
    })
    .sort({ dueDate: 1, createdAt: 1 })
    .toArray();
  const rows = orders.map((o) => {
    const dto = orderToDto(o, now);
    return [
      dto.id,
      csvEscape(dto.customer),
      dto.currency,
      dto.dueDate,
      dto.status,
      dto.total,
      dto.amountPaid,
      dto.amountDue,
      dto.createdAt,
    ].join(",");
  });
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
