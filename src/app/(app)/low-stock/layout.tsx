import { getSession } from "@/lib/session";
export default async function ModuleLayout({ children }: { children: React.ReactNode }) {
  await getSession("low_stock");
  return children;
}
