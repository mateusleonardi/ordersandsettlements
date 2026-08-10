import { redirect } from "next/navigation";
import { AppNav } from "@/components/nav";
import { Dashboard } from "@/components/dashboard";
import { getSessionUser } from "@/lib/server-session";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <>
      <AppNav email={user.email} />
      <Dashboard />
    </>
  );
}
