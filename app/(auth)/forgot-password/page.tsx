import { AuthLayout } from "@/components/auth-form";
import { PasswordResetRequestForm } from "@/components/password-reset-forms";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { loadTurnstileEnabled } from "@/lib/captcha-configuration";

export const generateMetadata=()=>localizedPageMetadata("meta.forgotPassword");

export default async function ForgotPasswordPage() {
  const turnstileEnabled=await loadTurnstileEnabled().catch(()=>false);
  return (
    <AuthLayout>
      <PasswordResetRequestForm turnstileEnabled={turnstileEnabled} />
    </AuthLayout>
  );
}
