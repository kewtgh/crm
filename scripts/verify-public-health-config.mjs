const publicUrl = new URL(process.env.LUMINA_PUBLIC_HEALTH_URL ?? "https://crm.ewaya.com/api/health");
const originUrl = new URL(process.env.LUMINA_ORIGIN_URL ?? "https://origin.example.invalid");
if (publicUrl.protocol !== "https:" || originUrl.protocol !== "https:") {
  throw new Error("PUBLIC_AND_ORIGIN_URLS_MUST_USE_HTTPS");
}
if (publicUrl.hostname === originUrl.hostname) {
  throw new Error("PUBLIC_AND_ORIGIN_HOSTNAMES_MUST_DIFFER");
}
if (publicUrl.pathname !== "/api/health" || publicUrl.search) {
  throw new Error("PUBLIC_HEALTH_MUST_TARGET_MINIMAL_LIVENESS");
}
process.stdout.write(
  `[public-health-config] valid public host ${publicUrl.hostname}; origin host is distinct; no request sent.\n`,
);
