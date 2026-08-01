import { AuthLayout } from "@/components/auth-form";
import { PasswordResetRequestForm } from "@/components/password-reset-forms";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { loadCaptchaProviderConfiguration } from "@/lib/captcha-configuration";

export const generateMetadata=()=>localizedPageMetadata("meta.forgotPassword");

export default async function ForgotPasswordPage() {
  const captchaConfiguration=await loadCaptchaProviderConfiguration();
  const turnstileEnabled=captchaConfiguration.status === "ready"
    ? captchaConfiguration.turnstileEnabled
    : null;
  return (
    <AuthLayout>
      <PasswordResetRequestForm turnstileEnabled={turnstileEnabled} />
    </AuthLayout>
  );
}
