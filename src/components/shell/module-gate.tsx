"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store-context";
import { MODULES, moduleForPath } from "@/lib/modules";

export function AccessDenied() {
  const { store, canModule } = useStore();
  const available = MODULES.filter((m) => canModule(m.key));
  return (
    <section className="mx-auto max-w-xl rounded-xl border border-border bg-surface p-6 sm:p-8">
      <p className="text-xs font-medium uppercase tracking-wider text-primary-hover">
        {store.name}
      </p>
      <h1 className="mt-2 text-2xl font-semibold">Access required</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Ask your store owner to enable this module in Access Control. You can
        also switch to another assigned store.
      </p>
      {available.length > 0 ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {available.map((m) => (
            <Link
              className="focus-ring rounded-md border border-border px-3 py-2 text-sm hover:bg-surface-2"
              href={m.href}
              key={m.key}
            >
              {m.label}
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted">
          No modules have been enabled for you at this store.
        </p>
      )}
    </section>
  );
}
export function ModuleGate({ children }: { children: React.ReactNode }) {
  const key = moduleForPath(usePathname());
  const { canModule } = useStore();
  return key && !canModule(key) ? <AccessDenied /> : children;
}
