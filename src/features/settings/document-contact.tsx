"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useStore } from "@/lib/store-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBillingAction } from "@/features/billing/use-billing-action";
export function DocumentContactSettings() {
  const { store, can } = useStore();
  const query = useQuery({
    queryKey: ["billing", "document-contact", store.businessId],
    enabled: can("owner"),
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("businesses")
        .select("document_address,document_phone,document_email")
        .eq("id", store.businessId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  if (!can("owner")) return null;
  if (query.error)
    return <p role="alert">Could not load document contact details.</p>;
  if (!query.data) return null;
  return <ContactForm key={JSON.stringify(query.data)} initial={query.data} />;
}
function ContactForm({
  initial,
}: {
  initial: {
    document_address: string | null;
    document_phone: string | null;
    document_email: string | null;
  };
}) {
  const { store } = useStore(),
    action = useBillingAction();
  const [address, setAddress] = useState(initial.document_address ?? ""),
    [phone, setPhone] = useState(initial.document_phone ?? ""),
    [email, setEmail] = useState(initial.document_email ?? "");
  return (
    <details className="mt-5 rounded-lg border border-border bg-surface p-5">
      <summary className="cursor-pointer font-semibold">Delivery Document Contact Details</summary>
      <form
      className="mt-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(
          () =>
            createClient().rpc("set_document_contact", {
              p_business: store.businessId,
              p_address: address,
              p_phone: phone,
              p_email: email,
            }),
          "Document contact details saved",
        );
      }}
    >
      <p className="text-sm text-muted">
        Used on new delivery notes. Existing notes retain their business
        details.
      </p>
      <fieldset disabled={action.busy || !action.online} className="space-y-3">
        <label className="block">
          Business address
          <Input
            maxLength={1000}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </label>
        <label className="block">
          Business phone
          <Input
            maxLength={80}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label className="block">
          Business email
          <Input
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <Button type="submit">Save document contact details</Button>
      </fieldset>
      </form>
    </details>
  );
}
