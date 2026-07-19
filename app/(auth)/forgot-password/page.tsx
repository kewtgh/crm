import { AuthLayout } from "@/components/auth-form";
import { PasswordResetRequestForm } from "@/components/password-reset-forms";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata=()=>localizedPageMetadata("meta.resetPassword");

export default function ForgotPasswordPage() {
  return (
    <AuthLayout>
      <PasswordResetRequestForm />
    </AuthLayout>
  );
}
