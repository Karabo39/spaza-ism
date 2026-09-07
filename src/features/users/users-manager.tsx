"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus, Shield } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { LoadingRows, EmptyState } from "@/components/ui/misc";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { friendlyError } from "@/lib/format";
import type { MembershipRole } from "@/lib/db/database.types";
import { useOffline } from "@/lib/offline/offline-context";

type Member = {
  id: string;
  user_id: string;
  role: MembershipRole;
  is_active: boolean;
  name: string;
};

export function UsersManager() {
  const { store, user } = useStore();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);
  const [assignMember, setAssignMember] = React.useState<Member | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["members", store.businessId],
    queryFn: async () => {
      const supabase = createClient();
      const { data: members, error } = await supabase
        .from("memberships")
        .select("id, user_id, role, is_active")
        .eq("business_id", store.businessId);
      if (error) throw error;
      const ids = (members ?? []).map((m) => m.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      const nameById = new Map(
        (profiles ?? []).map((p) => [p.id, p.full_name ?? "Unknown"]),
      );
      return (members ?? []).map((m) => ({
        ...m,
        name: nameById.get(m.user_id) ?? "Unknown",
      })) as Member[];
    },
  });

  async function changeRole(m: Member, role: MembershipRole) {
    if (m.user_id === user.id) {
      toast.error("You can't change your own role");
      return;
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("memberships")
      .update({ role })
      .eq("id", m.id);
    if (error) toast.error(friendlyError(error.message));
    else {
      toast.success("Role updated");
      qc.invalidateQueries({ queryKey: ["members", store.businessId] });
    }
  }

  async function toggleActive(m: Member) {
    if (m.user_id === user.id) {
      toast.error("You can't deactivate yourself");
      return;
    }
    const supabase = createClient();
    const { error } = await supabase
      .from("memberships")
      .update({ is_active: !m.is_active })
      .eq("id", m.id);
    if (error) toast.error(friendlyError(error.message));
    else {
      toast.success(m.is_active ? "User deactivated" : "User reactivated");
      qc.invalidateQueries({ queryKey: ["members", store.businessId] });
    }
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus className="size-4" /> Add user
        </Button>
      </div>
      <div className="rounded-lg border border-border bg-surface">
        {error ? (
          <p role="alert" className="p-4 text-sm text-danger">
            {friendlyError(error.message)}
          </p>
        ) : isLoading ? (
          <LoadingRows cols={4} />
        ) : (data ?? []).length === 0 ? (
          <EmptyState icon={Shield} title="No team members" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {(data ?? []).map((m) => (
                <TR key={m.id}>
                  <TD className="font-medium">
                    {m.name}
                    {m.user_id === user.id ? (
                      <span className="ml-2 text-xs text-muted">(you)</span>
                    ) : null}
                  </TD>
                  <TD>
                    <Select
                      value={m.role}
                      onValueChange={(v) => changeRole(m, v as MembershipRole)}
                    >
                      <SelectTrigger className="h-8 w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee">Employee</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="owner">Owner</SelectItem>
                      </SelectContent>
                    </Select>
                  </TD>
                  <TD>
                    {m.is_active ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="neutral">Inactive</Badge>
                    )}
                  </TD>
                  <TD className="text-right">
                    {m.role === "owner" ? (
                      <span className="mr-2 text-xs text-muted">
                        All locations
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setAssignMember(m)}
                      >
                        Assign locations
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleActive(m)}
                      disabled={m.user_id === user.id}
                    >
                      {m.is_active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
      {addOpen && (
        <AddMemberDialog
          key={store.businessId}
          open={addOpen}
          onOpenChange={setAddOpen}
          onAdded={() =>
            qc.invalidateQueries({ queryKey: ["members", store.businessId] })
          }
        />
      )}
      {assignMember ? (
        <AssignLocationsDialog
          key={assignMember.id}
          member={assignMember}
          onClose={() => setAssignMember(null)}
        />
      ) : null}
    </>
  );
}

function AssignLocationsDialog({
  member,
  onClose,
}: {
  member: Member;
  onClose: () => void;
}) {
  const { store, stores } = useStore();
  const { online } = useOffline();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [ready, setReady] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    createClient()
      .from("store_memberships")
      .select("store_id")
      .eq("membership_id", member.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setError(friendlyError(error.message));
          return;
        }
        setSelected((data ?? []).map((r) => r.store_id));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [member.id]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || !online || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { error } = await createClient().rpc("set_member_locations", {
        p_membership: member.id,
        p_stores: selected,
      });
      if (error) throw error;
      toast.success("Location access saved");
      onClose();
    } catch (error) {
      setError(friendlyError((error as Error).message));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Locations for {member.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted">
          Only selected locations can be used. No selections removes all
          location access. Changes require a connection.
        </p>
        <form onSubmit={save} className="space-y-4">
          <fieldset disabled={!ready || busy || !online} className="space-y-2">
            <legend className="sr-only">Assigned locations</legend>
            {stores
              .filter((s) => s.businessId === store.businessId)
              .map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-3 rounded-md border border-border p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, s.id]
                          : ids.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {s.name}
                  <span className="ml-auto text-xs capitalize text-muted">
                    {s.locationType}
                  </span>
                </label>
              ))}
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy} disabled={!ready || !online}>
              Save access
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdded: () => void;
}) {
  const { store } = useStore();
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<MembershipRole>("employee");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("add_member_by_email", {
      p_business: store.businessId,
      p_email: email.trim(),
      p_role: role,
    });
    setBusy(false);
    if (error) {
      toast.error(friendlyError(error.message));
      return;
    }
    toast.success(
      role === "owner"
        ? "Owner added with access to all locations"
        : "User added. Select Assign locations to give them access.",
    );
    onOpenChange(false);
    onAdded();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add team member</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted">
          The person must already have an account. Ask them to sign up first,
          then add them here by email.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="m-email">Email</Label>
            <Input
              id="m-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@shop.co.za"
            />
          </div>
          <div>
            <Label>Role</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as MembershipRole)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="employee">
                  Employee — daily operations
                </SelectItem>
                <SelectItem value="manager">
                  Manager — adjustments, stock take, reports
                </SelectItem>
                <SelectItem value="owner">Owner — full access</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
