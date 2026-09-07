import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { SettingsForm } from "@/features/settings/settings-form";
import Link from "next/link";
import { OverrideCodeSettings } from "@/features/credit/override-approval";
import { BillingPreferences } from "@/features/billing/billing-preferences";
import { NotificationPreferences } from "@/features/settings/notification-preferences";
import { BusinessLogoSettings } from "@/features/settings/business-logo";
import { ReturnReasonSettings } from "@/features/billing/return-reason-settings";
import { DEFAULT_RETURN_REASONS } from "@/features/billing/return-reasons";

export default async function SettingsPage() {
  const session = await getSession("settings");
  if (!session?.activeStore) redirect("/onboarding");
  const store = session.activeStore;
  const supabase = await createClient();
  const { data: billing, error: billingError } = await supabase
    .from("billing_settings")
    .select("*")
    .eq("business_id", store.businessId)
    .maybeSingle();
  if (billingError) throw billingError;
  const { data: notifications, error: notificationsError } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("store_id", store.id);
  if (notificationsError) throw notificationsError;

  const [{ data: profile }, { data: storeRow }, { data: business }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, phone")
        .eq("id", session.userId)
        .maybeSingle(),
      supabase
        .from("stores")
        .select("id, name, code")
        .eq("id", store.id)
        .maybeSingle(),
      supabase
        .from("businesses")
        .select("id, name, currency")
        .eq("id", store.businessId)
        .maybeSingle(),
    ]);

  return (
    <>
      <PageHeader
        title="Settings"
        crumbs={[{ label: "Administration" }, { label: "Settings" }]}
      />
      <SettingsForm
        profile={{
          full_name: profile?.full_name ?? "",
          phone: profile?.phone ?? "",
        }}
        storeInfo={{
          id: storeRow?.id ?? store.id,
          name: storeRow?.name ?? store.name,
          code: storeRow?.code ?? "",
        }}
        business={{
          id: business?.id ?? store.businessId,
          name: business?.name ?? store.businessName,
          currency: business?.currency ?? "ZAR",
        }}
      />
      {store.role === "owner" && <p className="mt-5 rounded-lg border border-border bg-surface p-5 text-sm">Adding another store? <Link href="/stores" className="text-primary-hover underline">Open My Stores</Link> to add locations and set up staff and products.</p>}
      <BusinessLogoSettings />
      <OverrideCodeSettings />
      <BillingPreferences
        key={store.businessId}
        tax={Number(billing?.tax_percent ?? 0)}
        returnApproval={billing?.return_approval_required ?? true}
      />
      <NotificationPreferences
        key={`${store.id}:${session.userId}`}
        initial={notifications ?? []}
      />
      <ReturnReasonSettings
        key={`reasons:${store.businessId}`}
        initial={billing?.return_reasons ?? DEFAULT_RETURN_REASONS}
      />
    </>
  );
}
