import { handle } from "@/lib/http";
import { exportQuerySchema } from "@/domain/schemas";
import { requireUser } from "@/lib/auth";
import { exportOrdersCsv } from "@/lib/orders";

/** Downloads the user's orders as CSV, optionally filtered by due date. */
export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const url = new URL(req.url);
  const range = exportQuerySchema.parse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  const csv = await exportOrdersCsv(user, range);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="orders.csv"',
    },
  });
});
