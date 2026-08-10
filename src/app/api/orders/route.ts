import { handle, json, readJson } from "@/lib/http";
import { createOrderSchema, listOrdersQuerySchema } from "@/domain/schemas";
import { requireUser } from "@/lib/auth";
import { createOrder, listOrders } from "@/lib/orders";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const query = listOrdersQuerySchema.parse({
    status: url.searchParams.get("status") ?? undefined,
  });
  const orders = await listOrders(user, query.status);
  return json({ orders });
});

/**
 * Creates an order. Supports an optional Idempotency-Key header: replaying
 * the same key returns 200 with the original order instead of a duplicate.
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const input = createOrderSchema.parse(await readJson(req));
  const idempotencyKey = req.headers.get("idempotency-key") ?? undefined;
  const result = await createOrder(user, input, idempotencyKey);
  return json({ order: result.order }, result.idempotent ? 200 : 201);
});
