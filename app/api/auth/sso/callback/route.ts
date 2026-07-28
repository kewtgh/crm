import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hydrateStaffUser, nextAuthenticatedPath, userFromSupabase } from "@/lib/auth";
import { setAuthSessionCookies } from "@/lib/auth-session";
import { enterpriseSsoCookie, readEnterpriseSsoState } from "@/lib/enterprise-identity";
import { fetchWithTimeout } from "@/lib/fetch-timeout";
import { claimScimSsoIdentity } from "@/lib/scim";

type PkceResult = { access_token?: string; refresh_token?: string; expires_in?: number; user?: Record<string, unknown> };

function loginRedirect(code: string) {
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "http://localhost:3200";
  return new URL(`/login?ssoError=${encodeURIComponent(code)}`, base);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const cookieStore = await cookies();
  const state = await readEnterpriseSsoState(cookieStore.get(enterpriseSsoCookie)?.value);
  const code = url.searchParams.get("code");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let response: NextResponse;
  if (!state || !code || code.length > 4096 || !supabaseUrl || !anonKey) {
    response = NextResponse.redirect(loginRedirect("SSO_STATE_INVALID"));
  } else {
    try {
      const upstream = await fetchWithTimeout(`${supabaseUrl}/auth/v1/token?grant_type=pkce`, {
        method: "POST",
        headers: { apikey: anonKey, "content-type": "application/json" },
        body: JSON.stringify({ auth_code: code, code_verifier: state.verifier }),
      }, 10_000);
      const result = await upstream.json().catch(() => ({})) as PkceResult;
      const identityPayload = result.user ?? {};
      const claimed = upstream.ok && result.access_token ? await claimScimSsoIdentity(identityPayload) : null;
      if (claimed) {
        identityPayload.app_metadata = { role: claimed.role, account_status: "ACTIVE", workspace_id: claimed.workspace_id };
        identityPayload.user_metadata = {
          ...((identityPayload.user_metadata ?? {}) as Record<string,unknown>),
          chinese_name: claimed.display_name_zh,
          english_name: claimed.display_name_en,
        };
      }
      const baseUser = upstream.ok && result.access_token ? userFromSupabase(identityPayload) : null;
      const user = baseUser && result.access_token ? await hydrateStaffUser(baseUser, result.access_token) : null;
      if (!user || !result.access_token || !result.refresh_token) {
        response = NextResponse.redirect(loginRedirect("SSO_STAFF_ACCESS_DENIED"));
      } else {
        response = NextResponse.redirect(new URL(nextAuthenticatedPath(user), process.env.APP_URL ?? url.origin));
        setAuthSessionCookies(response, result);
      }
    } catch {
      response = NextResponse.redirect(loginRedirect("SSO_UNAVAILABLE"));
    }
  }
  response.cookies.set(enterpriseSsoCookie, "", { path: "/api/auth/sso/callback", maxAge: 0 });
  response.headers.set("cache-control", "no-store");
  return response;
}
