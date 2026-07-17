import { AuthLayout } from "@/components/auth-form";
import { NewPasswordForm } from "@/components/password-reset-forms";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.resetPassword");

export default function ResetPasswordPage() {
  return <AuthLayout><NewPasswordForm /></AuthLayout>;
}
