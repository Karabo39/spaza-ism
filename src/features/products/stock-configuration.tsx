"use client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
export type StockConfigurationValue = {
  tracking_type: "QUANTITY" | "SALES_ONLY";
  bulk_enabled: boolean;
  units_per_pack: string;
  bulk_unit: string;
};
export function StockConfiguration({
  value,
  onChange,
}: {
  value: StockConfigurationValue;
  onChange: (v: StockConfigurationValue) => void;
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-border bg-surface-2 p-3">
      <legend className="px-1 text-sm font-semibold">Stock tracking</legend>
      <Label htmlFor="tracking-type">Stock Tracking Type</Label>
      <select
        id="tracking-type"
        className="h-11 w-full rounded-md border border-border bg-input px-3 text-sm"
        value={value.tracking_type}
        onChange={(e) =>
          onChange({
            ...value,
            tracking_type: e.target
              .value as StockConfigurationValue["tracking_type"],
            bulk_enabled:
              e.target.value === "SALES_ONLY" ? false : value.bulk_enabled,
          })
        }
      >
        <option value="QUANTITY">Quantity Tracked</option>
        <option value="SALES_ONLY">Sales Tracked Only</option>
      </select>
      {value.tracking_type === "SALES_ONLY" ? (
        <p className="text-xs text-muted">
          Sales and quantities sold are recorded. No opening stock, stock
          deduction or expiry tracking is required.
        </p>
      ) : (
        <>
          <div
            role="group"
            aria-label="Bulk Stock"
            className="flex items-center gap-4 text-sm"
          >
            <span>Bulk Stock</span>
            {[true, false].map((enabled) => (
              <label
                key={String(enabled)}
                className="flex min-h-11 items-center gap-2"
              >
                <input
                  type="radio"
                  name="bulk-enabled"
                  checked={value.bulk_enabled === enabled}
                  onChange={() => onChange({ ...value, bulk_enabled: enabled })}
                />
                {enabled ? "Yes" : "No"}
              </label>
            ))}
          </div>
          {value.bulk_enabled && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="bulk-unit">Bulk unit</Label>
                <Input
                  id="bulk-unit"
                  required
                  maxLength={40}
                  value={value.bulk_unit}
                  onChange={(e) =>
                    onChange({ ...value, bulk_unit: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="units-per-pack">Units per bulk unit</Label>
                <Input
                  id="units-per-pack"
                  type="number"
                  min="1"
                  max="100000"
                  step="1"
                  required
                  value={value.units_per_pack}
                  onChange={(e) =>
                    onChange({ ...value, units_per_pack: e.target.value })
                  }
                />
              </div>
              <p className="col-span-2 text-xs text-muted">
                Bulk stock starts at zero and stays linked to this product.
                Receive packs through Goods In, then unpack when needed.
              </p>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
