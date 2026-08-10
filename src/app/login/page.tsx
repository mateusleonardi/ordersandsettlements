import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getSessionUser } from "@/lib/server-session";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");
  return <AuthForm mode="login" />;
}
