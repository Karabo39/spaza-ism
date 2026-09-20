"use client";
import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "./button";
export function CollapsibleSection({
  title,
  actions,
  children,
  defaultOpen = true,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2>
          <Button
            type="button"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronDown /> : <ChevronRight />}
            {title}
          </Button>
        </h2>
        {actions}
      </div>
      <div id={id} hidden={!open} className="space-y-3">
        {children}
      </div>
    </section>
  );
}
