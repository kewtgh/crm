import { AuthForm, AuthLayout } from "@/components/auth-form";
import { redirectAuthenticatedUser } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { enterpriseSsoConfiguration } from "@/lib/enterprise-identity";
import { loadCaptchaProviderConfiguration } from "@/lib/captcha-configuration";

export const generateMetadata = () => localizedPageMetadata("meta.login");

export default async function LoginPage({searchParams}:{searchParams:Promise<{ssoError?:string;security?:string}>}) {
  await redirectAuthenticatedUser();
  const {ssoError,security}=await searchParams;
  const captchaConfiguration=await loadCaptchaProviderConfiguration();
  const turnstileEnabled=captchaConfiguration.status === "ready"
    ? captchaConfiguration.turnstileEnabled
    : null;
  return <AuthLayout><AuthForm ssoEnabled={enterpriseSsoConfiguration().enabled} turnstileEnabled={turnstileEnabled} initialErrorCode={ssoError} initialNoticeCode={security} /></AuthLayout>;
}
