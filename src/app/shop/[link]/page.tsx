import type { Metadata } from "next";
import { CustomerShop } from "@/features/online-orders/customer-shop";
export const metadata: Metadata = {
  title: "Customer ordering | POS INVENTORY",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function ShopPage({
  params,
}: {
  params: Promise<{ link: string }>;
}) {
  const { link } = await params;
  return <CustomerShop key={link} link={link} />;
}
