import { PageHeader } from "@/components/shell/page-header";
import { MyStores } from "@/features/stores/my-stores";
export default function MyStoresPage() {
  return <><PageHeader title="My Stores" description="Add a location, assign your team and get its stock ready for trading." actions={<a className="focus-ring rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground" href="#new-location">Add store</a>} /><MyStores /></>;
}
