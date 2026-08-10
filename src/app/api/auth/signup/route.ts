import { handle, json, readJson } from "@/lib/http";
import { signupSchema } from "@/domain/schemas";
import { createSession, signup } from "@/lib/auth";

export const POST = handle(async (req) => {
  const input = signupSchema.parse(await readJson(req));
  const user = await signup(input.email, input.password);
  const { cookie } = await createSession(user._id);
  return json(
    { user: { id: user._id.toHexString(), email: user.email } },
    201,
    { "Set-Cookie": cookie },
  );
});
