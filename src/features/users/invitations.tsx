"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { useOffline } from "@/lib/offline/offline-context";
import { PermissionTree } from "./permission-tree";
import { MODULES, permissionSettings } from "@/lib/modules";
import { dateTime } from "@/lib/format";
import type {
  EmployeeInvitation,
  MembershipRole,
} from "@/lib/db/database.types";

export function invitationError(error: unknown) {
  const text =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error
        ? String((error as { message?: string }).message ?? "")
        : "";
  const errors: Record<string, string> = {
    USER_ALREADY_MEMBER:
      "This person is already a member. Update their access in the user list.",
    INVITATION_ALREADY_PENDING:
      "An invitation is already pending for this email. Resend or edit it below.",
    INVITATION_CHANGED: "This invitation changed. Refresh and try again.",
    INVITATION_RATE_LIMITED:
      "Please wait before creating or resending another invitation.",
    INVALID_LOCATION: "One of the selected stores is no longer available.",
    INVALID_MODULE_ACCESS: "Review the selected modules for this role.",
    INVALID_INVITATION: "Check the email and profile details.",
    FORBIDDEN: "Only an authorized owner can manage invitations.",
  };
  return (
    errors[text] ?? "Could not save the invitation. Refresh and try again."
  );
}
async function deliver(invitation: EmployeeInvitation) {
  const { data, error } = await createClient().functions.invoke(
    "employee-invitations",
    { body: { invitationId: invitation.id, version: invitation.version } },
  );
  if (error) {
    let message =
      "Invitation saved, but email delivery could not be confirmed. Refresh before resending.";
    if ("context" in error && error.context instanceof Response) {
      const body = await error.context.json().catch(() => null);
      if (typeof body?.error === "string") message = body.error;
    }
    toast.error(message);
    return;
  }
  if (data?.sent)
    toast.success("Invitation email sent. Access starts after account setup.");
}

export function Invitations() {
  const { store } = useStore();
  const { online } = useOffline();
  const cache = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [editor, setEditor] = useState<EmployeeInvitation | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const query = useQuery({
    queryKey: ["invitations", store.businessId],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("employee_invitations")
        .select("*")
        .eq("business_id", store.businessId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });
  async function action(item: EmployeeInvitation, cancel = false) {
    if (!online || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (cancel) {
        const { error } = await createClient().rpc(
          "cancel_employee_invitation",
          { p_invitation: item.id, p_expected: item.version },
        );
        if (error) throw error;
        toast.success(
          "Invitation cancelled. Its link can no longer grant access.",
        );
      } else await deliver(item);
    } catch (error) {
      toast.error(invitationError(error));
    } finally {
      lock.current = false;
      setBusy(false);
      await cache.invalidateQueries({ queryKey: ["invitations"] });
    }
  }
  return (
    <section className="mb-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Employee invitations</h2>
          <p className="text-sm text-muted">
            Choose store access before the employee completes their account.
          </p>
        </div>
        <Button onClick={() => setEditor("new")} disabled={!online}>
          Add user
        </Button>
      </div>
      {query.isLoading ? (
        <p role="status">Loading invitations...</p>
      ) : query.isError ? (
        <p role="alert">
          Could not load invitations.{" "}
          <Button onClick={() => query.refetch()}>Retry</Button>
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {query.data?.map((item) => {
            const expired =
              item.state === "PENDING" &&
              new Date(item.expires_at).getTime() <= now;
            const status = expired
              ? "Expired"
              : item.state === "ACCEPTED"
                ? "Accepted"
                : item.state === "CANCELLED"
                  ? "Cancelled"
                  : item.delivery === "SENT"
                    ? "Pending acceptance"
                    : item.delivery === "FAILED"
                      ? "Delivery not confirmed"
                      : item.sent_at
                        ? "Delivery pending"
                        : "Not sent";
            return (
              <article
                key={item.id}
                className="min-w-0 space-y-2 rounded-lg border border-border p-4 break-words"
              >
                <p className="font-medium">{item.email}</p>
                <p className="text-sm">
                  {item.first_name} {item.surname} ·{" "}
                  {item.role === "employee"
                    ? "Employee"
                    : item.role === "manager"
                      ? "Manager"
                      : "Owner"}
                </p>
                <p className="text-sm">
                  {status} · Expires {dateTime(item.expires_at)}
                </p>
                <p className="text-xs text-muted">
                  {item.role === "owner"
                    ? "All business stores"
                    : `${Object.keys(item.assignments).length} assigned store(s)`}
                </p>
                {item.state === "PENDING" && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !online}
                      onClick={() => action(item)}
                    >
                      {item.delivery === "SENT" || expired
                        ? "Resend invitation"
                        : "Send invitation"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !online}
                      onClick={() => setEditor(item)}
                    >
                      Edit access
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !online}
                      onClick={() => action(item, true)}
                    >
                      Cancel invitation
                    </Button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {query.data?.length === 100 && (
        <p className="text-sm text-muted">
          Showing the latest 100 invitations.
        </p>
      )}
      {editor && (
        <InvitationEditor
          key={editor === "new" ? store.businessId : editor.id}
          invitation={editor === "new" ? undefined : editor}
          close={() => setEditor(null)}
        />
      )}
    </section>
  );
}

function InvitationEditor({
  invitation,
  close,
}: {
  invitation?: EmployeeInvitation;
  close: () => void;
}) {
  const { store, stores } = useStore();
  const { online } = useOffline();
  const cache = useQueryClient();
  const [email, setEmail] = useState(invitation?.email ?? "");
  const [role, setRole] = useState<MembershipRole>(
    invitation?.role ?? "employee",
  );
  const [first, setFirst] = useState(invitation?.first_name ?? "");
  const [surname, setSurname] = useState(invitation?.surname ?? "");
  const [phone, setPhone] = useState(invitation?.phone ?? "");
  const [assignments, setAssignments] = useState<
    Record<string, Record<string, boolean>>
  >(invitation?.assignments ?? {});
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const locations = stores.filter((s) => s.businessId === store.businessId);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!review) {
      setReview(true);
      return;
    }
    if (!online || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const payload = {
        p_business: store.businessId,
        p_email: email.trim(),
        p_role: role,
        p_assignments: role === "owner" ? {} : assignments,
        p_first_name: first.trim(),
        p_surname: surname.trim(),
        p_phone: phone.trim(),
        ...(invitation
          ? { p_invitation: invitation.id, p_expected: invitation.version }
          : {}),
      };
      const serialized = JSON.stringify(payload);
      if (request.current?.payload !== serialized)
        request.current = { payload: serialized, id: crypto.randomUUID() };
      const db = createClient();
      const { data: id, error } = await db.rpc("save_employee_invitation", {
        ...payload,
        p_request: request.current.id,
      });
      if (error || !id) throw error;
      const { data: saved, error: readError } = await db
        .from("employee_invitations")
        .select("*")
        .eq("id", id)
        .single();
      if (readError) throw readError;
      // If a retry resolves an already-delivered creation, do not send again.
      if (saved.delivery !== "SENT") await deliver(saved);
      close();
    } catch (error) {
      toast.error(invitationError(error));
    } finally {
      lock.current = false;
      setBusy(false);
      await cache.invalidateQueries({ queryKey: ["invitations"] });
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {review
              ? "Review employee invitation"
              : invitation
                ? "Edit invitation access"
                : "Add employee"}
          </DialogTitle>
          <DialogDescription>
            The employee confirms this email and sets their own password. No
            access is active until setup is complete.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {review ? (
            <div className="space-y-4 rounded-lg border border-border p-4">
              <div className="break-words">
                <p className="font-medium">{email.trim()}</p>
                <p className="text-sm capitalize">{role}</p>
                {(first || surname) && (
                  <p className="text-sm">
                    {first} {surname}
                  </p>
                )}
                {phone && <p className="text-sm">{phone}</p>}
              </div>
              {role === "owner" ? (
                <p className="text-sm">
                  Full owner access to all stores, users and business settings.
                </p>
              ) : (
                locations
                  .filter((location) => assignments[location.id])
                  .map((location) => (
                    <div key={location.id}>
                      <p className="font-medium">{location.name}</p>
                      <p className="text-sm text-muted">
                        {MODULES.filter(
                          (module) => assignments[location.id][module.key],
                        )
                          .map((module) => module.label)
                          .join(", ") ||
                          "No modules enabled. Access will remain pending."}
                      </p>
                    </div>
                  ))
              )}
              <p className="text-sm text-muted">
                The employee will confirm their email and complete their profile
                before this access becomes active.
              </p>
            </div>
          ) : (
            <fieldset disabled={busy} className="space-y-4">
              <div>
                <Label htmlFor="invite-email">Email address</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  maxLength={254}
                  value={email}
                  readOnly={!!invitation}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {invitation && (
                  <p className="text-xs text-muted">
                    To correct the email, cancel this invitation and create
                    another.
                  </p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="invite-first">First name(s), optional</Label>
                  <Input
                    id="invite-first"
                    maxLength={100}
                    value={first}
                    onChange={(e) => setFirst(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="invite-surname">Surname, optional</Label>
                  <Input
                    id="invite-surname"
                    maxLength={100}
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="invite-phone">Phone, optional</Label>
                <Input
                  id="invite-phone"
                  type="tel"
                  maxLength={32}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  className="h-11 w-full rounded-md border border-border bg-input px-3"
                  value={role}
                  onChange={(e) => {
                    setRole(e.target.value as MembershipRole);
                    setAssignments({});
                  }}
                >
                  <option value="employee">Employee</option>
                  <option value="manager">Manager</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
              {role === "owner" ? (
                <p className="rounded-md border border-warning p-3 text-sm">
                  Owners can manage the business, users and access across all
                  stores.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="font-medium">Stores and module access</p>
                  {locations.map((location) => (
                    <fieldset
                      key={location.id}
                      className="rounded-md border border-border p-3"
                    >
                      <legend>
                        <label className="flex min-h-11 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!!assignments[location.id]}
                            onChange={(e) =>
                              setAssignments((old) => {
                                const next = { ...old };
                                if (e.target.checked) next[location.id] = {};
                                else delete next[location.id];
                                return next;
                              })
                            }
                          />
                          {location.name}
                        </label>
                      </legend>
                      {assignments[location.id] && (
                        <PermissionTree
                          role={role}
                          permissions={permissionSettings(role, {
                            ...Object.fromEntries(
                              MODULES.map((m) => [m.key, false]),
                            ),
                            ...assignments[location.id],
                          })}
                          onChange={(next) =>
                            setAssignments((old) => ({
                              ...old,
                              [location.id]: next,
                            }))
                          }
                        />
                      )}
                    </fieldset>
                  ))}
                  <p className="text-xs text-muted">
                    Unselected modules are blocked. Approval and refund
                    permissions still follow the existing rules.
                  </p>
                </div>
              )}
            </fieldset>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            {review && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setReview(false)}
              >
                Back to edit
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              loading={busy}
              disabled={
                !online ||
                (role !== "owner" && !Object.keys(assignments).length)
              }
            >
              {review ? "Send invitation" : "Review invitation"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
