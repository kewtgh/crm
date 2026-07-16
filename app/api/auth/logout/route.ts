import { NextResponse } from "next/server";
import { authCookieNames } from "@/lib/auth";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  for (const name of Object.values(authCookieNames)) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  return response;
}
