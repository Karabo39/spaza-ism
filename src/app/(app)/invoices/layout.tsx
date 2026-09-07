import { getSession } from "@/lib/session";
export default async function ModuleLayout({ children }: { children: React.ReactNode }) {
  await getSession("invoices");
  return children;
}
