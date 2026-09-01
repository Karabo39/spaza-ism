import { PageHeader } from "@/components/shell/page-header";
import { CheckPriceConsole } from "@/features/check-price/check-price-console";

export default function CheckPricePage() {
  return (
    <>
      <PageHeader title="Check Price" crumbs={[{ label: "Operations" }, { label: "Check Price" }]}
        description="Scan any product to see its price and available stock." />
      <CheckPriceConsole />
    </>
  );
}
