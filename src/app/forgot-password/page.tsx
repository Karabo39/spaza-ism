import { PasswordRecovery } from "@/features/auth/password-recovery";
import { PublicNavigation } from "@/components/shell/public-navigation";
export default function ForgotPasswordPage() {
  return (
    <>
      <PublicNavigation />
      <PasswordRecovery />
    </>
  );
}
