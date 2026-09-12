"use client";
import { Input } from "@/components/ui/input";
import { money } from "@/lib/format";
import {
  paymentSummary,
  type PaymentMode,
  type PaymentDraft,
} from "./payments";
export function PaymentFields({
  mode,
  draft,
  onChange,
  total,
  currency,
}: {
  mode: PaymentMode;
  draft: PaymentDraft;
  onChange: (d: PaymentDraft) => void;
  total: number;
  currency: string;
}) {
  const summary = paymentSummary(mode, draft, total);
  if (mode === "CREDIT") return null;
  return (
    <div className="space-y-3">
      {(["CASH", "CARD", "EFT"] as const)
        .filter((m) => mode === m || mode === "SPLIT")
        .map((method) => {
          const key = method.toLowerCase() as "cash" | "card" | "eft";
          return (
            <div
              key={method}
              className="space-y-2 rounded border border-border p-3"
            >
              <label className="text-sm">
                {method === "CASH"
                  ? "Cash received"
                  : `${method === "CARD" ? "Card" : "EFT"} amount`}
                <Input
                  inputMode="decimal"
                  value={draft[key]}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      [key]: e.target.value,
                      ...(key !== "cash" ? { [`${key}Confirmed`]: false } : {}),
                    })
                  }
                  placeholder="0.00"
                />
              </label>
              {key !== "cash" && (
                <>
                  <label className="text-xs">
                    Reference (optional)
                    <Input
                      maxLength={200}
                      value={draft[`${key}Reference`]}
                      onChange={(e) =>
                        onChange({
                          ...draft,
                          [`${key}Reference`]: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={draft[`${key}Confirmed`]}
                      onChange={(e) =>
                        onChange({
                          ...draft,
                          [`${key}Confirmed`]: e.target.checked,
                        })
                      }
                    />
                    I confirm this payment succeeded externally.
                  </label>
                </>
              )}
            </div>
          );
        })}
      <div aria-live="polite" className="space-y-1 text-sm">
        <p>
          Total received: <strong>{money(summary.received, currency)}</strong>
        </p>
        <p>
          Remaining: <strong>{money(summary.remaining, currency)}</strong>
        </p>
        <p>
          Change due: <strong>{money(summary.change, currency)}</strong>
        </p>
        {summary.error && <p className="text-danger">{summary.error}</p>}
      </div>
    </div>
  );
}
