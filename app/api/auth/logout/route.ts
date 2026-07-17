import { NextResponse } from "next/server";
import { authCookieNames } from "@/lib/auth";
import { mutationIsTrusted } from "@/lib/request-security";
import { getAccessToken, supabaseRequest } from "@/lib/supabase-server";
import { apiErrorResponse } from "@/lib/api";

export async function POST(request: Request) {
  if (!mutationIsTrusted(request)) return apiErrorResponse("UNTRUSTED_ORIGIN", 403);
  const token = await getAccessToken();
  if (token) {
    await supabaseRequest("/auth/v1/logout?scope=local", { method: "POST" }, token).catch(() => undefined);
  }
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  for (const name of Object.values(authCookieNames)) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return response;
}
