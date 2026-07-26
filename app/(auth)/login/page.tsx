import { AuthForm, AuthLayout } from "@/components/auth-form";
import { redirectAuthenticatedUser } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { enterpriseSsoConfiguration } from "@/lib/enterprise-identity";

export const generateMetadata = () => localizedPageMetadata("meta.login");

export default async function LoginPage({searchParams}:{searchParams:Promise<{ssoError?:string}>}) {
  await redirectAuthenticatedUser();
  const {ssoError}=await searchParams;
  return <AuthLayout><AuthForm ssoEnabled={enterpriseSsoConfiguration().enabled} initialErrorCode={ssoError} /></AuthLayout>;
}
