import { handle, json, readJson } from "@/lib/http";
import { loginSchema } from "@/domain/schemas";
import { createSession, login } from "@/lib/auth";

export const POST = handle(async (req) => {
  const input = loginSchema.parse(await readJson(req));
  const user = await login(input.email, input.password);
  const { cookie } = await createSession(user._id);
  return json(
    { user: { id: user._id.toHexString(), email: user.email } },
    200,
    { "Set-Cookie": cookie },
  );
});
