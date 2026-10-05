import type { Metadata } from "next";
import { CustomerTracking } from "@/features/online-orders/customer-tracking";
export const metadata: Metadata = {
  title: "Private order tracking | POS INVENTORY",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function TrackingPage({
  params,
}: {
  params: Promise<{ link: string; order: string }>;
}) {
  const { link, order } = await params;
  return <CustomerTracking link={link} order={order} />;
}
