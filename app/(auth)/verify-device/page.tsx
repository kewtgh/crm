import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-form";
import { DeviceVerificationForm } from "@/components/device-verification-form";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { readPendingDeviceVerification, securityCookieNames } from "@/lib/trusted-devices";

export const generateMetadata = () => localizedPageMetadata("meta.mfa");

export default async function VerifyDevicePage() {
  const cookieStore = await cookies();
  const pending = await readPendingDeviceVerification(
    cookieStore.get(securityCookieNames.pendingDeviceVerification)?.value,
  );
  if (!pending) redirect("/login");
  return <AuthLayout><DeviceVerificationForm remembered={pending.remember} /></AuthLayout>;
}
