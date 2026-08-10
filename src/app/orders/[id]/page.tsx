import { redirect } from "next/navigation";
import { AppNav } from "@/components/nav";
import { OrderDetail } from "@/components/order-detail";
import { getSessionUser } from "@/lib/server-session";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  return (
    <>
      <AppNav email={user.email} />
      <OrderDetail orderId={id} />
    </>
  );
}
