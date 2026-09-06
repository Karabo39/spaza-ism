import Link from "next/link";
import { Warehouse, ArrowRightLeft, PackageCheck, PackageOpen } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
const actions = [
  { href: "/operations/warehouse", label: "Warehouse stock", description: "View stock stored in your assigned warehouses.", icon: Warehouse },
  { href: "/operations/transfers", label: "Transfer stock", description: "Create and dispatch a transfer between permitted locations.", icon: ArrowRightLeft },
  { href: "/operations/receive", label: "Receive transfer", description: "Confirm arrival and add dispatched stock to its destination.", icon: PackageCheck },
  { href: "/operations/unpack", label: "Unpack bulk stock", description: "Turn packs into individual units at the active location.", icon: PackageOpen },
];
export default function OperationsPage() {
  return <><PageHeader title="Operations" description="Receive, move and unpack stock across your stores and warehouses." /><div className="grid gap-4 sm:grid-cols-2">{actions.map(({ href, label, description, icon: Icon }) => <Link key={href} href={href} className="focus-ring rounded-lg border border-border bg-surface p-6 transition-colors hover:bg-surface-2"><Icon className="mb-4 size-6 text-primary-hover" /><h2 className="font-semibold">{label}</h2><p className="mt-2 text-sm text-muted">{description}</p></Link>)}</div><p className="mt-5 text-sm text-muted">Transfers and unpacking require a connection. Every stock change is recorded with its reference and operator.</p></>;
}
