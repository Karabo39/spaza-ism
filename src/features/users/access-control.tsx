"use client";
import * as React from "react";
import { OnlineOrderingButton } from "@/features/online-orders/ordering-settings";
import { PermissionTree } from "./permission-tree";
import { ReturnAccess } from "./return-access";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { createClient } from "@/lib/supabase/client";
import {
  PERMISSIONS,
  permissionSettings,
  type ModulePermissions,
} from "@/lib/modules";
import type { MembershipRole, Json } from "@/lib/db/database.types";
import { Button } from "@/components/ui/button";
import { friendlyError } from "@/lib/format";

type MemberAccess = {
  id: string;
  name: string;
  role: MembershipRole;
  active: boolean;
  assigned: boolean;
  permissions: Json;
  version: number;
};
export function AccessControl() {
  const { store } = useStore();
  const [selected, setSelected] = React.useState("");
  const [section, setSection] = React.useState<"owner" | "employee" | null>(
    null,
  );
  const members = useQuery({
    queryKey: ["module-members", store.id],
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<MemberAccess[]> => {
      const db = createClient();
      const [{ data: people }, { data: assigned }, { data: grants }] =
        await Promise.all([
          db
            .from("memberships")
            .select("id, user_id, role, is_active")
            .eq("business_id", store.businessId)
            .throwOnError(),
          db
            .from("store_memberships")
            .select("membership_id")
            .eq("store_id", store.id)
            .throwOnError(),
          db
            .from("store_module_access")
            .select("membership_id, permissions, version")
            .eq("store_id", store.id)
            .throwOnError(),
        ]);
      const ids = (people ?? []).map((m) => m.user_id);
      const { data: profiles } = ids.length
        ? await db
            .from("profiles")
            .select("id, full_name")
            .in("id", ids)
            .throwOnError()
        : { data: [] };
      return (people ?? [])
        .map((m) => {
          const grant = grants?.find((g) => g.membership_id === m.id);
          return {
            id: m.id,
            role: m.role,
            active: m.is_active,
            name:
              profiles?.find((p) => p.id === m.user_id)?.full_name ||
              "Team member",
            assigned:
              m.role === "owner" ||
              !!assigned?.some((a) => a.membership_id === m.id),
            permissions: grant?.permissions ?? {},
            version: grant?.version ?? 0,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
  const member = members.data?.find((m) => m.id === selected);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/25 bg-primary/5 p-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">
            Permissions for this store
          </p>
          <h2 className="mt-1 text-lg font-semibold">{store.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Changes here apply only to this store. Owners retain full access.
          </p>
        </div>
        <Link
          href="/users"
          className="focus-ring text-sm font-medium text-primary-hover underline underline-offset-4"
        >
          Add users or assign stores
        </Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["owner", "employee"] as const).map((r) => (
          <button
            key={r}
            className="rounded-xl border border-border bg-surface p-6 text-left focus-ring"
            onClick={() => {
              setSection(r);
              setSelected("");
            }}
          >
            <h2 className="text-lg font-semibold">
              {r === "owner" ? "Owner" : "Employee"}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {r === "owner"
                ? "Full access to all modules and stores"
                : "Individual module and function access for each store"}
            </p>
          </button>
        ))}
      </div>
      <section className="rounded-xl border border-border bg-surface p-6 space-y-3">
        <h2 className="text-lg font-semibold">Online Order Access</h2>
        <p className="text-sm text-muted">
          Owners retain full access. Employee permissions apply separately to
          this store: view Online Orders, process orders and confirm payments,
          manage ordering links and settings, and publish online products.
          Cancellation still requires order approval access; deliveries require
          delivery access.
        </p>
        <div className="flex flex-wrap gap-2">
          <OnlineOrderingButton />
          <Button
            variant="secondary"
            onClick={() => {
              setSection("employee");
              setSelected("");
            }}
          >
            Manage employee permissions
          </Button>
        </div>
      </section>
      {members.isLoading ? (
        <p role="status">Loading team access…</p>
      ) : members.error ? (
        <p role="alert" className="text-danger">
          Could not load permissions.{" "}
          <Button variant="ghost" onClick={() => members.refetch()}>
            Try again
          </Button>
        </p>
      ) : member ? (
        <>
          <Button variant="secondary" onClick={() => setSelected("")}>
            Back to employees
          </Button>
          {!member.active ? (
            <p className="rounded-lg border border-border p-5">
              This user is inactive. Reactivate them in Users before granting
              access.
            </p>
          ) : !member.assigned ? (
            <p className="rounded-lg border border-border p-5">
              Assign this person to {store.name} in Users first.
            </p>
          ) : (
            <PermissionEditor
              key={`${store.id}:${member.id}`}
              member={member}
            />
          )}
        </>
      ) : (
        section && (
          <div className="rounded-xl border border-border divide-y divide-border">
            {members.data
              ?.filter(
                (m) => (m.role === "owner" ? "owner" : "employee") === section,
              )
              .map((m) => (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div>
                    <p className="font-semibold">{m.name}</p>
                    <p className="text-sm text-muted">
                      {m.role === "owner" ? "Owner" : "Employee"} ·{" "}
                      {m.active ? "Active" : "Inactive"}
                      {!m.assigned ? " · Not assigned to this store" : ""}
                    </p>
                  </div>
                  <Button onClick={() => setSelected(m.id)}>
                    {m.role === "owner"
                      ? "View full access"
                      : "View / Manage Access"}
                  </Button>
                </div>
              ))}
            {!members.data?.some(
              (m) => (m.role === "owner" ? "owner" : "employee") === section,
            ) && (
              <p className="p-4">
                No {section === "owner" ? "owners" : "employees"} found.
              </p>
            )}
          </div>
        )
      )}
    </div>
  );
}

export function PermissionEditor({ member }: { member: MemberAccess }) {
  const { store } = useStore();
  const { online } = useOffline();
  const initial = permissionSettings(member.role, member.permissions);
  const [permissions, setPermissions] =
    React.useState<ModulePermissions>(initial);
  const [saved, setSaved] = React.useState(initial);
  const [version, setVersion] = React.useState(member.version);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const owner = member.role === "owner";
  const dirty = PERMISSIONS.some((m) => permissions[m.key] !== saved[m.key]);
  async function save() {
    if (!online || busy || owner) return;
    setBusy(true);
    setError("");
    try {
      const { data, error } = await createClient().rpc(
        "set_store_module_access",
        {
          p_membership: member.id,
          p_store: store.id,
          p_permissions: permissions,
          p_expected: version,
        },
      );
      if (error) throw error;
      setVersion(data);
      setSaved({ ...permissions });
      toast.success(`Access saved for ${member.name} at ${store.name}`);
    } catch (e) {
      const message = (e as Error).message;
      setError(
        message.includes("ACCESS_CHANGED_REFRESH")
          ? "Someone changed these permissions. Reload the page to review their changes before saving again."
          : friendlyError(message),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border border-border bg-surface">
      {member.role === "employee" && <ReturnAccess membership={member.id} />}
      <div className="flex items-start gap-3 border-b border-border p-5">
        <ShieldCheck className="mt-1 size-5 shrink-0 text-primary-hover" />
        <div>
          <h2 className="font-semibold">
            {member.name} · <span className="capitalize">{member.role}</span>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {owner
              ? "Owners always have all modules so they can manage and recover access."
              : "Expand Dashboard, Orders or Invoicing to choose individual options. Parent and linked-module access are required. Approval and management actions are granted separately."}
          </p>
        </div>
      </div>
      <div className="p-5">
        <PermissionTree
          role={member.role}
          permissions={permissions}
          onChange={setPermissions}
          disabled={busy || !online}
        />
      </div>
      {!owner && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border p-5">
          <Button onClick={save} disabled={!online || !dirty} loading={busy}>
            Save access
          </Button>
          <Button
            variant="ghost"
            disabled={!dirty || busy}
            onClick={() => setPermissions({ ...saved })}
          >
            Discard changes
          </Button>
          <p className="text-xs text-muted">
            {!online
              ? "Connect to change access."
              : dirty
                ? "You have unsaved changes."
                : "Changes are saved for this store only."}
          </p>
          {error && (
            <p className="w-full text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
