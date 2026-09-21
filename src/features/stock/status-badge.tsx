import { Badge } from "@/components/ui/badge";

export function StockStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "not_tracked":
      return <Badge variant="neutral">Sales Tracked Only</Badge>;
    case "out":
      return <Badge variant="danger">Out of stock</Badge>;
    case "low":
      return <Badge variant="warning">Low</Badge>;
    case "reorder":
      return <Badge variant="accent">Reorder</Badge>;
    default:
      return <Badge variant="success">In stock</Badge>;
  }
}
