import { handle, json, readJson } from "@/lib/http";
import { updateOrderSchema } from "@/domain/schemas";
import { requireUser } from "@/lib/auth";
import { deleteOrder, getOrderDetail, updateOrder } from "@/lib/orders";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const detail = await getOrderDetail(user, id);
  return json(detail);
});

export const PATCH = handle<Ctx>(async (req, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const input = updateOrderSchema.parse(await readJson(req));
  const order = await updateOrder(user, id, input);
  return json({ order });
});

export const DELETE = handle<Ctx>(async (req, ctx) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  await deleteOrder(user, id);
  return json({ ok: true });
});
