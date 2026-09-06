import { PageHeader } from "@/components/shell/page-header";
import { UnpackConsole } from "@/features/operations/unpack-console";
export default function UnpackPage() {
  return <><PageHeader title="Unpack bulk stock" description="Convert sealed packs into individual stock units using a manager-configured ratio." crumbs={[{ label: "Operations", href: "/operations" }, { label: "Unpack bulk stock" }]} /><UnpackConsole /></>;
}
