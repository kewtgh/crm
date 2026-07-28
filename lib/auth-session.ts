import type { NextResponse } from "next/server";
import { authCookieNames } from "./auth";

export const persistentSessionMaxAge = 60 * 60 * 24 * 30;

type SessionTokens = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

function cookieBase() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function setAuthSessionCookies(
  response: NextResponse,
  session: SessionTokens,
) {
  const base = cookieBase();
  if (session.access_token) {
    response.cookies.set(
      authCookieNames.access,
      session.access_token,
      { ...base, maxAge: Number(session.expires_in ?? 3600) },
    );
  }
  if (session.refresh_token) {
    response.cookies.set(
      authCookieNames.refresh,
      session.refresh_token,
      { ...base, maxAge: persistentSessionMaxAge },
    );
  }
  response.cookies.set(authCookieNames.persistence, "1", {
    ...base,
    maxAge: persistentSessionMaxAge,
  });
}

export function clearAuthSessionCookies(response: NextResponse) {
  for (const name of Object.values(authCookieNames)) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
}
