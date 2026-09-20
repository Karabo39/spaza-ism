import { AddStoreButton } from "@/features/stores/add-store-button";
import { PageHeader } from "@/components/shell/page-header";
import { MyStores } from "@/features/stores/my-stores";
export default function MyStoresPage() {
  return (
    <>
      <PageHeader
        title="My Stores"
        description="Add a location, assign your team and get its stock ready for trading."
        actions={<AddStoreButton />}
      />
      <MyStores />
    </>
  );
}
