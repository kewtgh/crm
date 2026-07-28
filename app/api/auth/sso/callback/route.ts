import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { nextAuthenticatedPath } from "@/lib/auth";
import { setAuthSessionCookies } from "@/lib/auth-session";
import { appUserFromIdentity, findAccountByIdentifier } from "@/lib/auth/accounts";
import { createSession } from "@/lib/auth/session-store";
import {
  enterpriseSsoConfiguration,
  enterpriseSsoCookie,
  readEnterpriseSsoState,
} from "@/lib/enterprise-identity";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { claimScimSsoIdentity } from "@/lib/scim";
import { applicationOrigin } from "@/lib/application-origin.mjs";

function loginRedirect(code: string, requestUrl: string) {
  return new URL(`/login?ssoError=${encodeURIComponent(code)}`, applicationOrigin(requestUrl));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const state = await readEnterpriseSsoState(cookieStore.get(enterpriseSsoCookie)?.value);
  const code = url.searchParams.get("code");
  const suppliedState = url.searchParams.get("state");
  const configuration = enterpriseSsoConfiguration();
  let response: NextResponse;
  if (
    !configuration.enabled
    || !state
    || !code
    || code.length > 4096
    || suppliedState !== state.state
  ) {
    response = NextResponse.redirect(loginRedirect("SSO_STATE_INVALID", request.url));
  } else {
    try {
      const callback = new URL("/api/auth/sso/callback", applicationOrigin(request.url)).toString();
      const tokenResponse = await fetchWithTimeout(configuration.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: callback,
          client_id: configuration.clientId,
          client_secret: configuration.clientSecret,
          code_verifier: state.verifier,
        }),
      }, 10_000);
      const token = await tokenResponse.json().catch(() => ({})) as { access_token?: string };
      if (!tokenResponse.ok || !token.access_token) throw new Error("SSO_TOKEN_REJECTED");
      const userInfoResponse = await fetchWithTimeout(configuration.userInfoUrl, {
        headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" },
      }, 10_000);
      const userInfo = await userInfoResponse.json().catch(() => ({})) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
      };
      const email = userInfo.email?.trim().toLowerCase();
      if (
        !userInfoResponse.ok
        || !userInfo.sub
        || !email
        || email !== state.email
        || userInfo.email_verified === false
      ) throw new Error("SSO_IDENTITY_REJECTED");
      let identity = await findAccountByIdentifier(email);
      if (!identity) throw new Error("SSO_STAFF_ACCESS_DENIED");
      await claimScimSsoIdentity({ id: identity.id, email }).catch(() => null);
      identity = await findAccountByIdentifier(email);
      if (!identity || identity.status !== "ACTIVE") throw new Error("SSO_STAFF_ACCESS_DENIED");
      const session = await createSession({
        userId: identity.id,
        passwordVersion: identity.passwordVersion,
        persistent: true,
        request,
      });
      const user = appUserFromIdentity(identity);
      response = NextResponse.redirect(new URL(nextAuthenticatedPath(user), applicationOrigin(request.url)));
      setAuthSessionCookies(response, session);
    } catch {
      response = NextResponse.redirect(loginRedirect("SSO_UNAVAILABLE", request.url));
    }
  }
  response.cookies.set(enterpriseSsoCookie, "", { path: "/api/auth/sso/callback", maxAge: 0 });
  response.headers.set("cache-control", "no-store");
  return response;
}
