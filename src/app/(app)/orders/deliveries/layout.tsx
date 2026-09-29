import { getSession } from "@/lib/session";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  await getSession("orders_deliveries");
  return children;
}
