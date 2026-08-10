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

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const input = createOrderSchema.parse(await readJson(req));
  const order = await createOrder(user, input);
  return json({ order }, 201);
});
