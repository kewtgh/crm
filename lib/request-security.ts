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
  if (environment.NODE_ENV === "production") return Boolean(configured && origin === configured);
  const requestOrigin = secureEndpointOrigin(request.url);
  return origin === configured || origin === requestOrigin;
}
