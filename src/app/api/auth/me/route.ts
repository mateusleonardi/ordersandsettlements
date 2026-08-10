import { handle, json } from "@/lib/http";
import { requireUser } from "@/lib/auth";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return json({ user: { id: user._id.toHexString(), email: user.email } });
});
