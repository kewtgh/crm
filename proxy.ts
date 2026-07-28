import { NextResponse, type NextRequest } from "next/server";
import { configuredApplicationOrigin, configuredSupabaseOrigin } from "./lib/application-origin.mjs";

export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const development = process.env.NODE_ENV !== "production";
  let secureAppOrigin = false;
  try {
    secureAppOrigin = new URL(configuredApplicationOrigin() ?? request.url).protocol === "https:";
  } catch {
    secureAppOrigin = false;
  }
  const supabaseOrigin = configuredSupabaseOrigin();
  const supabaseSocketOrigin = supabaseOrigin
    ? `${supabaseOrigin.startsWith("https:") ? "wss:" : "ws:"}//${new URL(supabaseOrigin).host}`
    : null;
  const supabaseConnectSources = [supabaseOrigin, supabaseSocketOrigin].filter(Boolean).join(" ");
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${supabaseOrigin ? ` ${supabaseOrigin}` : ""}`,
    `connect-src 'self'${supabaseConnectSources ? ` ${supabaseConnectSources}` : ""} https://challenges.cloudflare.com${development ? " http://127.0.0.1:* ws://127.0.0.1:*" : ""}`,
    "frame-src https://challenges.cloudflare.com",
    "font-src 'self' data:",
    ...(secureAppOrigin ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  if (secureAppOrigin) response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
