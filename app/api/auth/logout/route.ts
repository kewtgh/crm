import { NextResponse } from "next/server";
import { authCookieNames } from "@/lib/auth";
import { mutationIsTrusted } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!mutationIsTrusted(request)) return NextResponse.json({ code: "UNTRUSTED_ORIGIN" }, { status: 403 });
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  for (const name of Object.values(authCookieNames)) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return response;
}
