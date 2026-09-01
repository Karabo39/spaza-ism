"use client";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Truck } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, LoadingRows } from "@/components/ui/misc";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { friendlyError } from "@/lib/format";
import type { Tables } from "@/lib/db/database.types";

type Supplier = Tables<"suppliers">;

export function SuppliersManager() {
  const { store } = useStore();
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<Supplier | null>(null);
  const [open, setOpen] = React.useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["suppliers", store.businessId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.from("suppliers").select("*").eq("business_id", store.businessId).order("name");
      if (error) throw error;
      return data as Supplier[];
    },
  });

  function openNew() { setEditing(null); setOpen(true); }
  function openEdit(s: Supplier) { setEditing(s); setOpen(true); }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button size="sm" onClick={openNew}><Plus className="size-4" /> Add supplier</Button>
      </div>
      <div className="rounded-lg border border-border bg-surface">
        {isLoading ? <LoadingRows cols={4} /> :
          isError ? <EmptyState icon={Truck} title="Couldn't load suppliers" action={<Button size="sm" onClick={() => refetch()}>Retry</Button>} /> :
          (data ?? []).length === 0 ? <EmptyState icon={Truck} title="No suppliers yet" description="Add suppliers to track where your stock comes from." /> : (
          <Table>
            <THead><TR><TH>Supplier</TH><TH>Contact</TH><TH>Phone</TH><TH>Status</TH><TH className="w-10" /></TR></THead>
            <TBody>
              {(data ?? []).map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium">{s.name}</TD>
                  <TD className="text-muted">{s.contact_name ?? "—"}</TD>
                  <TD className="text-muted">{s.phone ?? "—"}</TD>
                  <TD>{s.is_active ? <Badge variant="success">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}</TD>
                  <TD><Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(s)}><Pencil className="size-4" /></Button></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
      <SupplierDialog open={open} onOpenChange={setOpen} supplier={editing}
        onSaved={() => qc.invalidateQueries({ queryKey: ["suppliers", store.businessId] })} />
    </>
  );
}

function SupplierDialog({
  open, onOpenChange, supplier, onSaved,
}: {
  open: boolean; onOpenChange: (v: boolean) => void; supplier: Supplier | null; onSaved: () => void;
}) {
  const { store } = useStore();
  const [form, setForm] = React.useState({ name: "", contact_name: "", phone: "", email: "", is_active: true });
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) setForm({
      name: supplier?.name ?? "", contact_name: supplier?.contact_name ?? "",
      phone: supplier?.phone ?? "", email: supplier?.email ?? "", is_active: supplier?.is_active ?? true,
    });
  }, [open, supplier]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const payload = {
      business_id: store.businessId, name: form.name.trim(),
      contact_name: form.contact_name.trim() || null, phone: form.phone.trim() || null,
      email: form.email.trim() || null, is_active: form.is_active,
    };
    const { error } = supplier
      ? await supabase.from("suppliers").update(payload).eq("id", supplier.id)
      : await supabase.from("suppliers").insert(payload);
    setBusy(false);
    if (error) { toast.error(friendlyError(error.message)); return; }
    toast.success(supplier ? "Supplier updated" : "Supplier added");
    onOpenChange(false); onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{supplier ? "Edit supplier" : "Add supplier"}</DialogTitle></DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div><Label htmlFor="s-name">Name</Label><Input id="s-name" required autoFocus value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="s-contact">Contact person</Label><Input id="s-contact" value={form.contact_name} onChange={(e) => setForm(f => ({ ...f, contact_name: e.target.value }))} /></div>
            <div><Label htmlFor="s-phone">Phone</Label><Input id="s-phone" value={form.phone} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
          </div>
          <div><Label htmlFor="s-email">Email</Label><Input id="s-email" type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          {supplier ? (
            <label className="flex items-center justify-between rounded-md border border-border bg-surface-2 p-3 text-sm">
              <span>Active</span>
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm(f => ({ ...f, is_active: e.target.checked }))} />
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={busy}>{supplier ? "Save" : "Add supplier"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
