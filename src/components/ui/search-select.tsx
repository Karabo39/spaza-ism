"use client";
import { useId, useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "./input";
/** Search and selection share one keyboard-accessible control. */
export function SearchSelect({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: { id: string; label: string; searchText?: string }[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const selected = options.find((o) => o.id === value);
  const rows = options.filter((o) =>
    `${o.label} ${o.searchText ?? ""}`.toLowerCase().includes(term.toLowerCase()),
  );
  const index = Math.min(active, Math.max(rows.length - 1, 0));
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${index}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [id, index, open]);
  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setTerm("");
  }
  return (
    <div
      className="relative min-w-0"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setOpen(false);
          setTerm("");
        }
      }}
    >
      <label htmlFor={id} className="mb-1.5 block text-sm">
        {label}
      </label>
      <div className="relative">
        <Input
          ref={input}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={
            open && rows.length ? `${id}-${index}` : undefined
          }
          disabled={disabled}
          placeholder="Search or select…"
          value={open ? term : (selected?.label ?? value)}
          className="pr-10"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setTerm(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setTerm("");
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive(
                Math.max(
                  0,
                  Math.min(
                    rows.length - 1,
                    index + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            }
            if (e.key === "Enter" && open) {
              e.preventDefault();
              if (rows[index]) choose(rows[index].id);
            }
          }}
        />
        <button
          type="button"
          aria-label={`Open ${label}`}
          disabled={disabled}
          className="absolute right-0 top-0 h-full px-3"
          onClick={() => {
            if (open) setOpen(false);
            else {
              setOpen(true);
              input.current?.focus();
            }
          }}
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-surface shadow-xl"
        >
          {rows.map((o, i) => (
            <li
              id={`${id}-${i}`}
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              className={`cursor-pointer break-words p-3 text-sm ${i === index ? "bg-surface-2" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o.id)}
            >
              {o.label}
            </li>
          ))}
          {!rows.length && (
            <li className="p-3 text-sm text-muted">No matches</li>
          )}
        </ul>
      )}
    </div>
  );
}
