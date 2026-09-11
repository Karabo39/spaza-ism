"use client";
import { useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  MODULES,
  MODULE_FEATURES,
  PERMISSIONS,
  ROLE_RANK,
  type ModuleKey,
  type ModulePermissions,
} from "@/lib/modules";
import type { MembershipRole } from "@/lib/db/database.types";
export function PermissionTree({
  role,
  permissions,
  onChange,
  disabled = false,
}: {
  role: MembershipRole;
  permissions: ModulePermissions;
  onChange: (next: ModulePermissions) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const renderNode = (
    key: ModuleKey,
    parentEnabled = true,
  ): React.ReactNode => {
    const item = PERMISSIONS.find((p) => p.key === key)!;
    const children = MODULE_FEATURES.filter((f) => f.parent === key);
    const eligible = ROLE_RANK[role] >= ROLE_RANK[item.role];
    const linked =
      "requires" in item
        ? item.requires.map((k) => PERMISSIONS.find((p) => p.key === k)!.label)
        : [];
    return (
      <div key={key}>
        <div className="flex min-h-11 items-center rounded-md hover:bg-surface-2">
          {children.length ? (
            <button
              type="button"
              className="focus-ring flex size-9 shrink-0 items-center justify-center"
              aria-label={`${expanded.has(key) ? "Collapse" : "Expand"} ${item.label}`}
              aria-expanded={expanded.has(key)}
              onClick={() =>
                setExpanded((old) => {
                  const next = new Set(old);
                  if (next.has(key)) next.delete(key);
                  else next.add(key);
                  return next;
                })
              }
            >
              {expanded.has(key) ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
          ) : (
            <span className="w-9 shrink-0" />
          )}
          <label
            className={`flex flex-1 items-center gap-3 py-2 text-sm ${!eligible || !parentEnabled ? "text-muted" : ""}`}
          >
            <input
              type="checkbox"
              className="size-4 shrink-0 accent-primary"
              checked={permissions[key]}
              disabled={
                disabled || role === "owner" || !eligible || !parentEnabled
              }
              onChange={(e) =>
                onChange({ ...permissions, [key]: e.target.checked })
              }
            />
            <span>
              {item.label}
              {!eligible ? (
                <span className="block text-xs capitalize">
                  {item.role} role required
                </span>
              ) : linked.length > 0 ? (
                <span className="block text-xs text-muted">
                  Also requires {linked.join(" and ")}
                </span>
              ) : null}
            </span>
          </label>
        </div>
        {children.length > 0 && expanded.has(key) && (
          <div
            className="ml-4 border-l border-border pl-2"
            role="group"
            aria-label={`${item.label} options`}
          >
            {children.map((child) =>
              renderNode(child.key, parentEnabled && permissions[key]),
            )}
          </div>
        )}
      </div>
    );
  };
  return (
    <div className="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
      {[...new Set(MODULES.map((m) => m.group))].map((group) => (
        <fieldset key={group}>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {group}
          </legend>
          {MODULES.filter((m) => m.group === group).map((m) =>
            renderNode(m.key),
          )}
        </fieldset>
      ))}
    </div>
  );
}
