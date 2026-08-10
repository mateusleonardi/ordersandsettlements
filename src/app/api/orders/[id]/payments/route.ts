import { handle, json, readJson } from "@/lib/http";
import { paymentSchema } from "@/domain/schemas";
import { requireUser } from "@/lib/auth";
import { recordPayment } from "@/lib/orders";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Records a payment. Supports an optional Idempotency-Key header: replaying
 * the same key returns 200 with the original payment instead of creating a
 * duplicate (double click, network retry). A fresh payment returns 201.
 */
export const POST = handle<Ctx>(async (req, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const input = paymentSchema.parse(await readJson(req));
  const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;
  const result = await recordPayment(user, id, input, idempotencyKey);
  return json(
    { order: result.order, payment: result.payment },
    result.idempotent ? 200 : 201,
  );
});
