import { redirect } from "next/navigation";
import { AppNav } from "@/components/nav";
import { OrderForm } from "@/components/order-form";
import { getSessionUser } from "@/lib/server-session";

export default async function NewOrderPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <>
      <AppNav email={user.email} />
      <OrderForm />
    </>
  );
}
