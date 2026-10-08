const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,63}$/;

export function validMailbox(value) {
  if (typeof value !== "string" || !value || value.length > 320 || /[\r\n]/.test(value)) {
    return false;
  }
  const bracketed = value.match(/^[^<>]{1,120}<([^<>]+)>$/);
  const address = (bracketed?.[1] ?? value).trim();
  return address.length >= 3
    && address.length <= 254
    && !/[\r\n,;]/.test(address)
    && EMAIL.test(address);
}

export function validEmailBrand(value) {
  return value === "ewaya" || value === "ewaya CRM";
}

export function validBrandedSender(value) {
  return validMailbox(value) && /^ewaya(?: CRM)?\s*<[^<>]+>$/.test(value);
}

export function parseHttpsUrl(value, { originOnly = false } = {}) {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 2_048) {
    return null;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:"
    || url.username
    || url.password
    || (originOnly && (url.pathname !== "/" || url.search || url.hash))) {
    return null;
  }
  return url;
}

export function validRoutePath(value) {
  if (typeof value !== "string"
    || value !== value.trim()
    || value.length < 2
    || value.length > 200
    || !value.startsWith("/")
    || value.includes("//")
    || value.includes("?")
    || value.includes("#")
    || value.includes(":")) {
    return false;
  }
  const segments = value.slice(1).split("/");
  return segments.every((segment) => (
    segment !== "."
    && segment !== ".."
    && SAFE_PATH_SEGMENT.test(segment)
  ));
}

export function validResendApiKey(value) {
  return typeof value === "string"
    && value.length > 3
    && value === value.trim()
    && value.startsWith("re_")
    && /^[\x20-\x7e]+$/u.test(value)
    && !/[\u0000-\u001f\u007f]/u.test(value)
    && !/\s/u.test(value);
}

export function validatedRuntimeConfiguration(env) {
  const from = typeof env.EMAIL_FROM === "string" ? env.EMAIL_FROM.trim() : "";
  const replyTo = typeof env.EMAIL_REPLY_TO === "string" ? env.EMAIL_REPLY_TO.trim() : "";
  const brandName = typeof env.EMAIL_BRAND_NAME === "string"
    ? env.EMAIL_BRAND_NAME.trim()
    : "";
  const deliveryPath = typeof env.DELIVERY_PATH === "string" ? env.DELIVERY_PATH : "";
  const healthPath = typeof env.HEALTH_PATH === "string" ? env.HEALTH_PATH : "";
  const provider = env.EMAIL_PROVIDER ?? "RESEND";
  if (!["RESEND","SMTP_RELAY"].includes(provider)) return null;
  const relay = provider === "SMTP_RELAY" ? parseHttpsUrl(env.EMAIL_RELAY_URL) : null;
  const apiKey = provider === "RESEND" ? env.RESEND_API_KEY : env.EMAIL_RELAY_TOKEN;
  const validKey = provider === "RESEND" ? validResendApiKey(apiKey)
    : !!relay && typeof apiKey === "string" && /^[A-Za-z0-9._~-]{32,512}$/.test(apiKey);
  const webhookToken = typeof env.LUMINA_WEBHOOK_TOKEN === "string"
    ? env.LUMINA_WEBHOOK_TOKEN
    : "";
  const applicationUrl = parseHttpsUrl(env.CRM_APP_URL);

  if (!validKey
    || !webhookToken
    || !applicationUrl
    || !validBrandedSender(from)
    || (replyTo && !validMailbox(replyTo))
    || !validEmailBrand(brandName)
    || !validRoutePath(deliveryPath)
    || !validRoutePath(healthPath)
    || deliveryPath === healthPath) {
    return null;
  }

  return {
    provider,
    providerEndpoint: relay?.toString() ?? "https://api.resend.com/emails",
    apiKey,
    applicationUrl: applicationUrl.toString(),
    brandName,
    deliveryPath,
    from,
    healthPath,
    replyTo,
    webhookToken,
  };
}
