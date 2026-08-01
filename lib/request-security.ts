import { configuredApplicationOrigin, secureEndpointOrigin } from "./application-origin.mjs";

const csrfTokenPattern = /^[A-Za-z0-9_-]{32,128}$/;

export function originIsTrusted(
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
  return originTrusted;
}

export function sessionCsrfIsTrusted(request: Request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (/(?:^|;\s*)crm_session=/.test(cookieHeader)) {
    const csrfCookie = cookieHeader.match(/(?:^|;\s*)crm_csrf=([^;]+)/)?.[1];
    const csrfHeader = request.headers.get("x-csrf-token");
    if (
      !csrfCookie
      || !csrfHeader
      || !csrfTokenPattern.test(csrfCookie)
      || !csrfTokenPattern.test(csrfHeader)
      || csrfCookie !== csrfHeader
    ) return false;
  }
  return true;
}

export function preAuthMutationIsTrusted(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return originIsTrusted(request, environment);
}

export function mutationIsTrusted(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return originIsTrusted(request, environment) && sessionCsrfIsTrusted(request);
}
