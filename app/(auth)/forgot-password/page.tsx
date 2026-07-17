import { AuthLayout } from "@/components/auth-form";
import { PasswordResetRequestForm } from "@/components/password-reset-forms";

export default function ForgotPasswordPage() {
  return (
    <AuthLayout>
      <PasswordResetRequestForm />
    </AuthLayout>
  );
}
