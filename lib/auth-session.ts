import type { NextResponse } from "next/server";
import { authCookieNames } from "./auth";
import {
  csrfCookieName,
  persistentSessionMaxAge,
  type AuthenticatedSession,
} from "./auth/session-store";

export { persistentSessionMaxAge };

function cookieBase() {
  return {
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export function setAuthSessionCookies(
  response: NextResponse,
  session: Pick<AuthenticatedSession, "token" | "csrfToken" | "maxAge">,
) {
  const base = cookieBase();
  response.cookies.set(authCookieNames.session, session.token, {
    ...base,
    httpOnly: true,
    maxAge: session.maxAge,
  });
  response.cookies.set(csrfCookieName, session.csrfToken, {
    ...base,
    httpOnly: false,
    maxAge: session.maxAge,
  });
  response.cookies.set(authCookieNames.persistence, "1", {
    ...base,
    httpOnly: true,
    maxAge: session.maxAge,
  });
}

export function clearAuthSessionCookies(response: NextResponse) {
  for (const name of new Set(Object.values(authCookieNames))) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
  response.cookies.set(csrfCookieName, "", { path: "/", maxAge: 0 });
}
