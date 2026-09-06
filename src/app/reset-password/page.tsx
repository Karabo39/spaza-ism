import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PasswordRecovery } from "@/features/auth/password-recovery";
import { PublicNavigation } from "@/components/shell/public-navigation";
export default async function ResetPasswordPage() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/forgot-password");
  return (
    <>
      <PublicNavigation />
      <PasswordRecovery reset />
    </>
  );
}
