import { handle, json, readJson } from "@/lib/http";
import { refundSchema } from "@/domain/schemas";
import { requireUser } from "@/lib/auth";
import { recordRefund } from "@/lib/orders";

type Ctx = { params: Promise<{ id: string }> };

/** Records a refund against an order's net paid amount. */
export const POST = handle<Ctx>(async (req, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const input = refundSchema.parse(await readJson(req));
  const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;
  const result = await recordRefund(user, id, input, idempotencyKey);
  return json(
    { order: result.order, refund: result.payment },
    result.idempotent ? 200 : 201,
  );
});
