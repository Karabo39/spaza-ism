import { PageHeader } from "@/components/shell/page-header";
import { AccessControl } from "@/features/users/access-control";
export default function AccessControlPage() {
  return <><PageHeader title="Access Control" description="Choose which modules each team member can use at the active store. Switch stores to manage a different location." /><AccessControl /></>;
}
