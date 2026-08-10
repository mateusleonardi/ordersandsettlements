import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOrderVia,
  ctx,
  jsonRequest,
  payVia,
  readBody,
  refundVia,
  routes,
  signupUser,
  startTestDb,
  stopTestDb,
} from "./helpers";
import type { AuditDto, OrderDto, PaymentDto } from "../../src/lib/orders";

beforeAll(startTestDb);
afterAll(stopTestDb);

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe("auth", () => {
  it("rejects unauthenticated access to orders", async () => {
    const res = await routes.ordersGet(jsonRequest("GET", "/api/orders"), undefined);
    expect(res.status).toBe(401);
    const body = await readBody<ErrorBody>(res);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects duplicate signup emails with 409", async () => {
    const { POST: signupRoute } = await import(
      "../../src/app/api/auth/signup/route"
    );
    const email = `dupe-${Math.random().toString(36).slice(2, 8)}@test.dev`;
    const first = await signupRoute(
      jsonRequest("POST", "/api/auth/signup", { email, password: "password123" }),
      undefined,
    );
    expect(first.status).toBe(201);
    const second = await signupRoute(
      jsonRequest("POST", "/api/auth/signup", { email, password: "password123" }),
      undefined,
    );
    expect(second.status).toBe(409);
    expect((await readBody<ErrorBody>(second)).error.code).toBe("EMAIL_TAKEN");
  });

  it("identifies the session on /api/auth/me and rejects anonymous calls", async () => {
    const { GET: meRoute } = await import("../../src/app/api/auth/me/route");
    const { cookie, email } = await signupUser();
    const ok = await meRoute(
      jsonRequest("GET", "/api/auth/me", undefined, { cookie }),
      undefined,
    );
    expect(ok.status).toBe(200);
    const body = await readBody<{ user: { email: string } }>(ok);
    expect(body.user.email).toBe(email);

    const anon = await meRoute(jsonRequest("GET", "/api/auth/me"), undefined);
    expect(anon.status).toBe(401);
  });

  it("rejects cross-origin mutating requests when Origin mismatches", async () => {
    const { cookie } = await signupUser();
    const res = await createOrderVia(cookie, {});
    expect(res.status).toBe(201);

    const { POST: ordersPost } = await import("../../src/app/api/orders/route");
    const crossOrigin = await ordersPost(
      jsonRequest(
        "POST",
        "/api/orders",
        {
          customer: "Evil Co",
          currency: "USD",
          dueDate: "2030-01-01",
          lineItems: [{ description: "W", quantity: 1, unitPrice: "10" }],
        },
        { cookie, origin: "https://evil.test", host: "app.local" },
      ),
      undefined,
    );
    expect(crossOrigin.status).toBe(403);
    expect((await readBody<ErrorBody>(crossOrigin)).error.code).toBe("FORBIDDEN");
  });

  it("rejects wrong credentials with 401", async () => {
    const { POST: loginRoute } = await import("../../src/app/api/auth/login/route");
    const res = await loginRoute(
      jsonRequest("POST", "/api/auth/login", {
        email: "nobody@test.dev",
        password: "wrong-password",
      }),
      undefined,
    );
    expect(res.status).toBe(401);
    expect((await readBody<ErrorBody>(res)).error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("order creation and computation", () => {
  it("computes subtotal and total server-side", async () => {
    const { cookie } = await signupUser();
    const res = await createOrderVia(cookie, {
      lineItems: [
        { description: "Widget", quantity: 2, unitPrice: "500" },
        { description: "Fee", quantity: 1, unitPrice: "10.50" },
      ],
    });
    expect(res.status).toBe(201);
    const { order } = await readBody<{ order: OrderDto }>(res);
    expect(order.subtotal).toBe("1010.50");
    expect(order.total).toBe("1010.50");
    expect(order.amountPaid).toBe("0.00");
    expect(order.amountDue).toBe("1010.50");
    expect(order.status).toBe("pending");
    expect(order.editable).toBe(true);
  });

  it("rejects invalid input with specific messages", async () => {
    const { cookie } = await signupUser();
    const badQuantity = await createOrderVia(cookie, {
      lineItems: [{ description: "W", quantity: 0, unitPrice: "10" }],
    });
    expect(badQuantity.status).toBe(400);
    const qtyBody = await readBody<ErrorBody>(badQuantity);
    expect(qtyBody.error.code).toBe("VALIDATION_ERROR");
    expect(qtyBody.error.message).toContain("Quantity");

    const badAmount = await createOrderVia(cookie, {
      lineItems: [{ description: "W", quantity: 1, unitPrice: "10.123" }],
    });
    expect(badAmount.status).toBe(400);
    expect((await readBody<ErrorBody>(badAmount)).error.message).toContain(
      "decimal place",
    );

    const zeroTotal = await createOrderVia(cookie, {
      lineItems: [{ description: "W", quantity: 1, unitPrice: "0" }],
    });
    expect(zeroTotal.status).toBe(400);
    expect((await readBody<ErrorBody>(zeroTotal)).error.message).toContain(
      "greater than zero",
    );

    // quantity x max unit price would overflow safe integers.
    const overflow = await createOrderVia(cookie, {
      lineItems: [
        { description: "W", quantity: 1_000_000, unitPrice: "10000000000" },
      ],
    });
    expect(overflow.status).toBe(400);
    expect((await readBody<ErrorBody>(overflow)).error.message).toContain(
      "too large",
    );
  });

  it("respects currency minor units (KWD has 3, JPY has 0)", async () => {
    const { cookie } = await signupUser();
    const kwd = await createOrderVia(cookie, {
      currency: "KWD",
      lineItems: [{ description: "Svc", quantity: 1, unitPrice: "10.500" }],
    });
    expect(kwd.status).toBe(201);
    expect((await readBody<{ order: OrderDto }>(kwd)).order.total).toBe("10.500");

    const jpyBad = await createOrderVia(cookie, {
      currency: "JPY",
      lineItems: [{ description: "Svc", quantity: 1, unitPrice: "10.5" }],
    });
    expect(jpyBad.status).toBe(400);
  });
});

describe("currency immutability", () => {
  it("ignores currency on PATCH: not part of the update contract", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie, {
      currency: "KWD",
      lineItems: [{ description: "Svc", quantity: 1, unitPrice: "100" }],
    });
    const { order } = await readBody<{ order: OrderDto }>(created);
    expect(order.currency).toBe("KWD");

    // Unknown keys are stripped; currency alone leaves nothing to update.
    const currencyOnly = await routes.orderPatch(
      jsonRequest("PATCH", `/api/orders/${order.id}`, { currency: "USD" }, { cookie }),
      ctx({ id: order.id }),
    );
    expect(currencyOnly.status).toBe(400);

    const mixed = await routes.orderPatch(
      jsonRequest(
        "PATCH",
        `/api/orders/${order.id}`,
        { customer: "Renamed", currency: "USD" },
        { cookie },
      ),
      ctx({ id: order.id }),
    );
    expect(mixed.status).toBe(200);
    const mixedBody = await readBody<{ order: OrderDto }>(mixed);
    expect(mixedBody.order.currency).toBe("KWD");
    expect(mixedBody.order.customer).toBe("Renamed");
  });

  it("validates payments against the order currency and stamps it on the entry", async () => {
    const { cookie } = await signupUser();
    const kwd = await createOrderVia(cookie, {
      currency: "KWD",
      lineItems: [{ description: "Svc", quantity: 1, unitPrice: "100" }],
    });
    const { order } = await readBody<{ order: OrderDto }>(kwd);

    // 4 decimal places exceed KWD's 3.
    const tooPrecise = await payVia(cookie, order.id, "10.1234");
    expect(tooPrecise.status).toBe(400);

    const ok = await payVia(cookie, order.id, "10.123");
    expect(ok.status).toBe(201);
    const okBody = await readBody<{ payment: PaymentDto }>(ok);
    expect(okBody.payment.currency).toBe("KWD");
    expect(okBody.payment.amount).toBe("10.123");

    // JPY has no minor decimal places at all.
    const jpy = await createOrderVia(cookie, {
      currency: "JPY",
      lineItems: [{ description: "Svc", quantity: 1, unitPrice: "1000" }],
    });
    const { order: jpyOrder } = await readBody<{ order: OrderDto }>(jpy);
    const fractionalYen = await payVia(cookie, jpyOrder.id, "10.5");
    expect(fractionalYen.status).toBe(400);
  });
});

describe("request edge cases", () => {
  it("handles malformed ids, bodies, filters and degenerate inputs", async () => {
    const { cookie } = await signupUser();

    // Non-ObjectId id: 404, never a 500.
    const badId = await routes.orderGet(
      jsonRequest("GET", "/api/orders/not-an-id", undefined, { cookie }),
      ctx({ id: "not-an-id" }),
    );
    expect(badId.status).toBe(404);

    // Malformed JSON body: 400 with a clear error.
    const badJson = await routes.ordersPost(
      new Request("http://test.local/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: "{not json",
      }),
      undefined,
    );
    expect(badJson.status).toBe(400);
    expect((await readBody<ErrorBody>(badJson)).error.message).toContain("JSON");

    // Unknown status filter: 400.
    const badStatus = await routes.ordersGet(
      jsonRequest("GET", "/api/orders?status=bogus", undefined, { cookie }),
      undefined,
    );
    expect(badStatus.status).toBe(400);

    // Inverted CSV date range: 400.
    const badRange = await routes.exportGet(
      jsonRequest(
        "GET",
        "/api/orders/export?from=2031-12-31&to=2031-01-01",
        undefined,
        { cookie },
      ),
      undefined,
    );
    expect(badRange.status).toBe(400);

    // Zero payment: 400 (minimum is one minor unit).
    const created = await createOrderVia(cookie);
    const { order } = await readBody<{ order: OrderDto }>(created);
    const zeroPay = await payVia(cookie, order.id, "0");
    expect(zeroPay.status).toBe(400);

    // Empty PATCH: 400 (nothing to update).
    const emptyPatch = await routes.orderPatch(
      jsonRequest("PATCH", `/api/orders/${order.id}`, {}, { cookie }),
      ctx({ id: order.id }),
    );
    expect(emptyPatch.status).toBe(400);
  });
});

describe("sample scenario from the assignment", () => {
  it("runs 1000 total, pay 400, pay 600, reject extra 1", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie, {
      lineItems: [{ description: "Consulting", quantity: 2, unitPrice: "500" }],
    });
    const { order } = await readBody<{ order: OrderDto }>(created);
    expect(order.total).toBe("1000.00");

    const p1 = await payVia(cookie, order.id, "400");
    expect(p1.status).toBe(201);
    const afterP1 = await readBody<{ order: OrderDto }>(p1);
    expect(afterP1.order.status).toBe("partially_paid");
    expect(afterP1.order.amountDue).toBe("600.00");

    const p2 = await payVia(cookie, order.id, "600");
    expect(p2.status).toBe(201);
    const afterP2 = await readBody<{ order: OrderDto }>(p2);
    expect(afterP2.order.status).toBe("paid");
    expect(afterP2.order.amountDue).toBe("0.00");

    const p3 = await payVia(cookie, order.id, "1");
    expect(p3.status).toBe(409);
    const err = await readBody<ErrorBody>(p3);
    expect(err.error.code).toBe("OVERPAYMENT");
    expect(err.error.message).toContain("fully paid");
  });

  it("includes the maximum allowed amount in over-payment errors", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie);
    const { order } = await readBody<{ order: OrderDto }>(created);

    await payVia(cookie, order.id, "400");
    const over = await payVia(cookie, order.id, "700");
    expect(over.status).toBe(409);
    const err = await readBody<ErrorBody>(over);
    expect(err.error.code).toBe("OVERPAYMENT");
    expect(err.error.details?.maxAllowed).toBe("600.00");
    expect(err.error.message).toContain("600.00");
  });
});

describe("status derivation over the API", () => {
  it("derives overdue for past due dates and paid wins over overdue", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie, { dueDate: "2020-01-01" });
    const { order } = await readBody<{ order: OrderDto }>(created);
    expect(order.status).toBe("overdue");

    await payVia(cookie, order.id, "1000");
    const detail = await routes.orderGet(
      jsonRequest("GET", `/api/orders/${order.id}`, undefined, { cookie }),
      ctx({ id: order.id }),
    );
    const body = await readBody<{ order: OrderDto }>(detail);
    expect(body.order.status).toBe("paid");
  });

  it("filters the list by derived status", async () => {
    const { cookie } = await signupUser();
    await createOrderVia(cookie, { customer: "Pending Co" });
    const paidRes = await createOrderVia(cookie, { customer: "Paid Co" });
    const { order: paidOrder } = await readBody<{ order: OrderDto }>(paidRes);
    await payVia(cookie, paidOrder.id, "1000");

    const list = await routes.ordersGet(
      jsonRequest("GET", "/api/orders?status=paid", undefined, { cookie }),
      undefined,
    );
    const { orders } = await readBody<{ orders: OrderDto[] }>(list);
    expect(orders).toHaveLength(1);
    expect(orders[0].customer).toBe("Paid Co");
  });
});

describe("immutability after payments", () => {
  it("blocks PATCH and DELETE once a payment exists", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie);
    const { order } = await readBody<{ order: OrderDto }>(created);

    // Editable before any payment.
    const patchOk = await routes.orderPatch(
      jsonRequest("PATCH", `/api/orders/${order.id}`, { customer: "Renamed" }, { cookie }),
      ctx({ id: order.id }),
    );
    expect(patchOk.status).toBe(200);

    await payVia(cookie, order.id, "100");

    const patchBlocked = await routes.orderPatch(
      jsonRequest("PATCH", `/api/orders/${order.id}`, { customer: "Nope" }, { cookie }),
      ctx({ id: order.id }),
    );
    expect(patchBlocked.status).toBe(409);
    expect((await readBody<ErrorBody>(patchBlocked)).error.code).toBe(
      "ORDER_NOT_EDITABLE",
    );

    const deleteBlocked = await routes.orderDelete(
      jsonRequest("DELETE", `/api/orders/${order.id}`, undefined, { cookie }),
      ctx({ id: order.id }),
    );
    expect(deleteBlocked.status).toBe(409);
  });
});

describe("refunds", () => {
  it("refunds reduce net paid and can regress status", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie);
    const { order } = await readBody<{ order: OrderDto }>(created);

    await payVia(cookie, order.id, "1000");
    const refund = await refundVia(cookie, order.id, "250");
    expect(refund.status).toBe(201);
    const afterRefund = await readBody<{ order: OrderDto }>(refund);
    expect(afterRefund.order.amountPaid).toBe("750.00");
    expect(afterRefund.order.status).toBe("partially_paid");

    // A payment for the refunded portion is allowed again.
    const repay = await payVia(cookie, order.id, "250");
    expect(repay.status).toBe(201);
    expect((await readBody<{ order: OrderDto }>(repay)).order.status).toBe("paid");
  });

  it("rejects refunds beyond the net paid amount with the maximum", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie);
    const { order } = await readBody<{ order: OrderDto }>(created);

    await payVia(cookie, order.id, "300");
    const tooBig = await refundVia(cookie, order.id, "400");
    expect(tooBig.status).toBe(409);
    const err = await readBody<ErrorBody>(tooBig);
    expect(err.error.code).toBe("REFUND_EXCEEDS_PAID");
    expect(err.error.details?.maxRefundable).toBe("300.00");

    const noPayments = await createOrderVia(cookie);
    const { order: fresh } = await readBody<{ order: OrderDto }>(noPayments);
    const refundFresh = await refundVia(cookie, fresh.id, "10");
    expect(refundFresh.status).toBe(409);
  });
});

describe("idempotency", () => {
  it("replaying the same Idempotency-Key returns the original payment", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie);
    const { order } = await readBody<{ order: OrderDto }>(created);

    const key = "retry-abc-123";
    const first = await payVia(cookie, order.id, "400", { idempotencyKey: key });
    expect(first.status).toBe(201);
    const firstBody = await readBody<{ payment: PaymentDto; order: OrderDto }>(first);

    const replay = await payVia(cookie, order.id, "400", { idempotencyKey: key });
    expect(replay.status).toBe(200);
    const replayBody = await readBody<{ payment: PaymentDto; order: OrderDto }>(replay);
    expect(replayBody.payment.id).toBe(firstBody.payment.id);
    // Net paid did not double.
    expect(replayBody.order.amountPaid).toBe("400.00");
  });

  it("replaying an order-creation key returns the original order", async () => {
    const { cookie } = await signupUser();
    const key = "create-once";
    const first = await createOrderVia(cookie, undefined, key);
    expect(first.status).toBe(201);
    const firstBody = await readBody<{ order: OrderDto }>(first);

    const replay = await createOrderVia(cookie, undefined, key);
    expect(replay.status).toBe(200);
    const replayBody = await readBody<{ order: OrderDto }>(replay);
    expect(replayBody.order.id).toBe(firstBody.order.id);

    const list = await routes.ordersGet(
      jsonRequest("GET", "/api/orders", undefined, { cookie }),
      undefined,
    );
    expect((await readBody<{ orders: OrderDto[] }>(list)).orders).toHaveLength(1);
  });

  it("rejects a payment key replayed with different parameters", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie);
    const { order } = await readBody<{ order: OrderDto }>(created);

    const key = "same-key-different-amount";
    const first = await payVia(cookie, order.id, "100", { idempotencyKey: key });
    expect(first.status).toBe(201);

    const mismatch = await payVia(cookie, order.id, "200", { idempotencyKey: key });
    expect(mismatch.status).toBe(409);
    expect((await readBody<ErrorBody>(mismatch)).error.code).toBe("CONFLICT");
  });

  it("keeps payment and refund idempotency keys independent", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie);
    const { order } = await readBody<{ order: OrderDto }>(created);

    const key = "shared-key";
    const pay = await payVia(cookie, order.id, "500", { idempotencyKey: key });
    expect(pay.status).toBe(201);

    // A refund reusing the same key must create a refund, not replay the payment.
    const { POST: refundsPost } = await import(
      "../../src/app/api/orders/[id]/refunds/route"
    );
    const refund = await refundsPost(
      jsonRequest(
        "POST",
        `/api/orders/${order.id}/refunds`,
        { amount: "200", date: "2030-01-02" },
        { cookie, "Idempotency-Key": key },
      ),
      ctx({ id: order.id }),
    );
    expect(refund.status).toBe(201);
    const refundBody = await readBody<{ refund: PaymentDto; order: OrderDto }>(refund);
    expect(refundBody.refund.type).toBe("refund");
    expect(refundBody.order.amountPaid).toBe("300.00");
  });

  it("dedupes concurrent submissions sharing a key", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie);
    const { order } = await readBody<{ order: OrderDto }>(created);

    const key = "double-click";
    const results = await Promise.all([
      payVia(cookie, order.id, "100", { idempotencyKey: key }),
      payVia(cookie, order.id, "100", { idempotencyKey: key }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 201]);

    const detail = await routes.orderGet(
      jsonRequest("GET", `/api/orders/${order.id}`, undefined, { cookie }),
      ctx({ id: order.id }),
    );
    const body = await readBody<{ order: OrderDto; payments: PaymentDto[] }>(detail);
    expect(body.payments).toHaveLength(1);
    expect(body.order.amountPaid).toBe("100.00");
  });
});

describe("concurrency", () => {
  it("two concurrent payments never exceed the order total", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie);
    const { order } = await readBody<{ order: OrderDto }>(created);

    // Both individually valid (600 <= 1000), but together they exceed it.
    const [a, b] = await Promise.all([
      payVia(cookie, order.id, "600"),
      payVia(cookie, order.id, "600"),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const rejected = a.status === 409 ? a : b;
    const err = await readBody<ErrorBody>(rejected);
    expect(err.error.code).toBe("OVERPAYMENT");
    expect(err.error.details?.maxAllowed).toBe("400.00");

    const detail = await routes.orderGet(
      jsonRequest("GET", `/api/orders/${order.id}`, undefined, { cookie }),
      ctx({ id: order.id }),
    );
    const body = await readBody<{ order: OrderDto; payments: PaymentDto[] }>(detail);
    expect(body.order.amountPaid).toBe("600.00");
    expect(body.payments).toHaveLength(1);
  });

  it("many concurrent small payments stop exactly at the total", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie, {
      lineItems: [{ description: "Cap", quantity: 1, unitPrice: "500" }],
    });
    const { order } = await readBody<{ order: OrderDto }>(created);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => payVia(cookie, order.id, "100")),
    );
    const accepted = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 409).length;
    expect(accepted).toBe(5);
    expect(rejected).toBe(3);

    const detail = await routes.orderGet(
      jsonRequest("GET", `/api/orders/${order.id}`, undefined, { cookie }),
      ctx({ id: order.id }),
    );
    const body = await readBody<{ order: OrderDto }>(detail);
    expect(body.order.amountPaid).toBe("500.00");
    expect(body.order.status).toBe("paid");
  });
});

describe("tenant isolation", () => {
  it("hides other users' orders from list, detail, payment and delete", async () => {
    const alice = await signupUser();
    const bob = await signupUser();
    const created = await createOrderVia(alice.cookie, { customer: "Alice Co" });
    const { order } = await readBody<{ order: OrderDto }>(created);

    const bobList = await routes.ordersGet(
      jsonRequest("GET", "/api/orders", undefined, { cookie: bob.cookie }),
      undefined,
    );
    expect((await readBody<{ orders: OrderDto[] }>(bobList)).orders).toHaveLength(0);

    const bobDetail = await routes.orderGet(
      jsonRequest("GET", `/api/orders/${order.id}`, undefined, { cookie: bob.cookie }),
      ctx({ id: order.id }),
    );
    expect(bobDetail.status).toBe(404);

    const bobPay = await payVia(bob.cookie, order.id, "100");
    expect(bobPay.status).toBe(404);

    const bobDelete = await routes.orderDelete(
      jsonRequest("DELETE", `/api/orders/${order.id}`, undefined, { cookie: bob.cookie }),
      ctx({ id: order.id }),
    );
    expect(bobDelete.status).toBe(404);
  });
});

describe("audit log", () => {
  it("records creation, payments and refunds with status transitions", async () => {
    const { cookie } = await signupUser();
    const created = await createOrderVia(cookie);
    const { order } = await readBody<{ order: OrderDto }>(created);
    await payVia(cookie, order.id, "400");
    await payVia(cookie, order.id, "600");
    await refundVia(cookie, order.id, "100");

    const detail = await routes.orderGet(
      jsonRequest("GET", `/api/orders/${order.id}`, undefined, { cookie }),
      ctx({ id: order.id }),
    );
    const { auditLog } = await readBody<{ auditLog: AuditDto[] }>(detail);
    const events = auditLog.map((e) => e.event);
    expect(events).toEqual([
      "order_created",
      "payment_recorded",
      "payment_recorded",
      "refund_recorded",
    ]);
    const fullPayment = auditLog[2];
    expect(fullPayment.statusBefore).toBe("partially_paid");
    expect(fullPayment.statusAfter).toBe("paid");
  });
});

describe("CSV export", () => {
  it("exports the user's orders filtered by due date range", async () => {
    const { cookie } = await signupUser();
    await createOrderVia(cookie, { customer: "In Range", dueDate: "2031-06-15" });
    await createOrderVia(cookie, { customer: "Out of Range", dueDate: "2032-01-01" });

    const res = await routes.exportGet(
      jsonRequest(
        "GET",
        "/api/orders/export?from=2031-01-01&to=2031-12-31",
        undefined,
        { cookie },
      ),
      undefined,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(
      "order_id,customer,currency,due_date,status,total,amount_paid,amount_due,created_at",
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("In Range");
    expect(csv).not.toContain("Out of Range");
  });

  it("neutralizes spreadsheet formula injection in free-text fields", async () => {
    const { cookie } = await signupUser();
    await createOrderVia(cookie, {
      customer: "=HYPERLINK(\"http://evil.test\",\"click\")",
      dueDate: "2033-05-05",
    });
    const res = await routes.exportGet(
      jsonRequest(
        "GET",
        "/api/orders/export?from=2033-01-01&to=2033-12-31",
        undefined,
        { cookie },
      ),
      undefined,
    );
    const csv = await res.text();
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/(^|\n)[^,]*=HYPERLINK/);
  });
});
