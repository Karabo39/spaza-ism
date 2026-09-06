"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
export function ListFilter({
  label,
  param,
  options,
  value,
}: {
  label: string;
  param: string;
  options: { value: string; label: string }[];
  value: string;
}) {
  const router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      {label}
      <select
        value={value}
        className="h-9 rounded-md border border-border bg-input px-3 text-foreground"
        onChange={(event) => {
          const next = new URLSearchParams(params.toString());
          next.set(param, event.target.value);
          next.delete("page");
          router.replace(`${pathname}?${next}`);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
