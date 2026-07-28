import { configuredApplicationOrigin, secureEndpointOrigin } from "./application-origin.mjs";

export function mutationIsTrusted(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return environment.NODE_ENV !== "production";
  const suppliedOrigin = secureEndpointOrigin(origin);
  if (!suppliedOrigin || suppliedOrigin !== origin) return false;
  const configured = configuredApplicationOrigin(environment);
  const originTrusted = environment.NODE_ENV === "production"
    ? Boolean(configured && origin === configured)
    : origin === configured || origin === secureEndpointOrigin(request.url);
  if (!originTrusted) return false;
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (/(?:^|;\s*)crm_session=/.test(cookieHeader)) {
    const csrfCookie = cookieHeader.match(/(?:^|;\s*)crm_csrf=([^;]+)/)?.[1];
    const csrfHeader = request.headers.get("x-csrf-token");
    if (
      !csrfCookie
      || !csrfHeader
      || !/^[A-Za-z0-9_-]{32,128}$/.test(csrfCookie)
      || csrfCookie !== csrfHeader
    ) return false;
  }
  return true;
}
