import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { SettingsForm } from "@/features/settings/settings-form";
import { LocationsManager } from "@/features/settings/locations-manager";
import { OverrideCodeSettings } from "@/features/credit/override-approval";
import { BillingPreferences } from "@/features/billing/billing-preferences";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();
  const { data: billing, error: billingError } = await supabase.from("billing_settings").select("*").eq("business_id",store.businessId).maybeSingle();
  if (billingError) throw billingError;

  const [{ data: profile }, { data: storeRow }, { data: business }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", session.userId).maybeSingle(),
    supabase.from("stores").select("id, name, code").eq("id", store.id).maybeSingle(),
    supabase.from("businesses").select("id, name, currency").eq("id", store.businessId).maybeSingle(),
  ]);

  return (
    <>
      <PageHeader title="Settings" crumbs={[{ label: "Administration" }, { label: "Settings" }]} />
      <SettingsForm
        profile={{ full_name: profile?.full_name ?? "", phone: profile?.phone ?? "" }}
        storeInfo={{ id: storeRow?.id ?? store.id, name: storeRow?.name ?? store.name, code: storeRow?.code ?? "" }}
        business={{ id: business?.id ?? store.businessId, name: business?.name ?? store.businessName, currency: business?.currency ?? "ZAR" }}
      />
      <LocationsManager />
      <OverrideCodeSettings />
      <BillingPreferences key={store.businessId} tax={Number(billing?.tax_percent??0)} returnApproval={billing?.return_approval_required??true}/>
    </>
  );
}
