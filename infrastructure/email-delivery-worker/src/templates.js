const APPOINTMENT_FIELDS = Object.freeze([
  "title_zh",
  "title_en",
  "starts_at",
  "ends_at",
  "channel",
  "related_label",
  "status",
]);

export const TEMPLATE_DEFINITIONS = Object.freeze({
  reminder: Object.freeze({
    requiredPayloadFields: Object.freeze(["reminderId"]),
    optionalPayloadFields: Object.freeze(["locale", "timezone"]),
  }),
  "password-reset": Object.freeze({
    requiredPayloadFields: Object.freeze(["url", "expiresInSeconds"]),
    optionalPayloadFields: Object.freeze([]),
  }),
  "device-verification": Object.freeze({
    requiredPayloadFields: Object.freeze(["code", "expiresInSeconds"]),
    optionalPayloadFields: Object.freeze([]),
  }),
  "email-verification": Object.freeze({
    requiredPayloadFields: Object.freeze(["url", "expiresInSeconds"]),
    optionalPayloadFields: Object.freeze([]),
  }),
  "staff-account-created": Object.freeze({
    requiredPayloadFields: Object.freeze([
      "username",
      "temporaryPassword",
      "loginUrl",
      "displayNameZh",
      "displayNameEn",
      "mustChangePassword",
      "mfaRequired",
    ]),
    optionalPayloadFields: Object.freeze([]),
  }),
  "communication-message": Object.freeze({
    requiredPayloadFields: Object.freeze(["subject", "body"]),
    optionalPayloadFields: Object.freeze(["recipientName"]),
  }),
  "calendar-invite": Object.freeze({
    requiredPayloadFields: Object.freeze(["eventVersion", "appointment"]),
    optionalPayloadFields: Object.freeze(["attendeeName"]),
  }),
  "calendar-update": Object.freeze({
    requiredPayloadFields: Object.freeze(["eventVersion", "appointment"]),
    optionalPayloadFields: Object.freeze(["attendeeName"]),
  }),
  "calendar-cancel": Object.freeze({
    requiredPayloadFields: Object.freeze(["eventVersion", "appointment"]),
    optionalPayloadFields: Object.freeze(["attendeeName"]),
  }),
});

export const TEMPLATE_KEYS = Object.freeze(Object.keys(TEMPLATE_DEFINITIONS));

export class TemplateValidationError extends Error {
  constructor(code) {
    super(code);
    this.name = "TemplateValidationError";
    this.code = code;
  }
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function requiredString(payload, key, { maximum = 10_000, allowEmpty = false } = {}) {
  const value = payload[key];
  if (typeof value !== "string") throw new TemplateValidationError("TEMPLATE_VARIABLE_INVALID");
  const normalized = value.trim();
  if ((!allowEmpty && !normalized) || value.length > maximum) {
    throw new TemplateValidationError("TEMPLATE_VARIABLE_INVALID");
  }
  return value;
}

function optionalString(payload, key, { maximum = 10_000 } = {}) {
  if (!Object.hasOwn(payload, key)) return "";
  return requiredString(payload, key, { maximum, allowEmpty: true });
}

function requiredBoolean(payload, key) {
  if (typeof payload[key] !== "boolean") {
    throw new TemplateValidationError("TEMPLATE_VARIABLE_INVALID");
  }
  return payload[key];
}

function requiredPositiveInteger(payload, key, maximum = 31_536_000) {
  const value = payload[key];
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TemplateValidationError("TEMPLATE_VARIABLE_INVALID");
  }
  return value;
}

function singleLine(value, maximum = 160) {
  return String(value).replace(/[\r\n]+/g, " ").trim().slice(0, maximum);
}

function durationLabel(seconds) {
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return `${seconds} seconds`;
}

function applicationUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new TemplateValidationError("TEMPLATE_URL_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new TemplateValidationError("TEMPLATE_URL_INVALID");
  }
  return url;
}

function internalUrl(value, configuredApplicationUrl) {
  const base = applicationUrl(configuredApplicationUrl);
  const supplied = applicationUrl(value);
  if (supplied.origin !== base.origin) {
    throw new TemplateValidationError("TEMPLATE_URL_INVALID");
  }
  return new URL(`${supplied.pathname}${supplied.search}${supplied.hash}`, base).toString();
}

function validatePayloadFields(template, payload) {
  const definition = TEMPLATE_DEFINITIONS[template];
  if (!definition) throw new TemplateValidationError("TEMPLATE_UNKNOWN");
  const allowed = new Set([
    ...definition.requiredPayloadFields,
    ...definition.optionalPayloadFields,
  ]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    throw new TemplateValidationError("TEMPLATE_VARIABLE_INVALID");
  }
  if (definition.requiredPayloadFields.some((key) => !Object.hasOwn(payload, key))) {
    throw new TemplateValidationError("TEMPLATE_VARIABLE_MISSING");
  }
}

function validateAppointment(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TemplateValidationError("TEMPLATE_VARIABLE_INVALID");
  }
  const keys = Object.keys(value);
  if (APPOINTMENT_FIELDS.some((key) => !Object.hasOwn(value, key))
    || keys.some((key) => !APPOINTMENT_FIELDS.includes(key))) {
    throw new TemplateValidationError("TEMPLATE_VARIABLE_INVALID");
  }
  const appointment = Object.fromEntries(APPOINTMENT_FIELDS.map((key) => [
    key,
    requiredString(value, key, { maximum: 500, allowEmpty: key === "related_label" }),
  ]));
  if (!appointment.title_zh.trim() && !appointment.title_en.trim()) {
    throw new TemplateValidationError("TEMPLATE_VARIABLE_INVALID");
  }
  for (const key of ["starts_at", "ends_at"]) {
    const date = new Date(appointment[key]);
    if (!Number.isFinite(date.getTime())) {
      throw new TemplateValidationError("TEMPLATE_VARIABLE_INVALID");
    }
    appointment[key] = date.toISOString();
  }
  return appointment;
}

function actionLink(url, label) {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#176b57;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(label)}</a></p>`;
}

function detailTable(rows) {
  const content = rows.map(([label, value]) => (
    `<tr><td style="padding:7px 12px 7px 0;color:#64748b;vertical-align:top">${escapeHtml(label)}</td>`
    + `<td style="padding:7px 0;color:#18332c;vertical-align:top">${escapeHtml(value)}</td></tr>`
  )).join("");
  return `<table role="presentation" style="border-collapse:collapse;width:100%;margin:14px 0">${content}</table>`;
}

function layout({ brandName, applicationUrl: appUrl, heading, bodyHtml, bodyText }) {
  const brand = escapeHtml(brandName);
  const footerUrl = new URL(appUrl).origin;
  const safeFooterUrl = escapeHtml(footerUrl);
  return {
    html: `<!doctype html><html><body style="margin:0;background:#f2f7f5;color:#18332c;font-family:Arial,sans-serif"><div style="padding:28px 12px"><div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #dbe8e3;border-radius:14px;overflow:hidden"><div style="padding:22px 28px;background:#176b57;color:#ffffff;font-size:18px;font-weight:800">${brand}</div><main style="padding:28px"><h1 style="margin:0 0 18px;font-size:24px;line-height:1.3">${escapeHtml(heading)}</h1>${bodyHtml}</main><footer style="padding:20px 28px;border-top:1px solid #e5eeea;color:#64748b;font-size:13px;line-height:1.6">${brand}<br><a href="${safeFooterUrl}" style="color:#176b57">${safeFooterUrl}</a></footer></div></div></body></html>`,
    text: `${heading}\n\n${bodyText}\n\n${brandName}\n${footerUrl}`,
  };
}

function calendarContent(template, payload) {
  const action = {
    "calendar-invite": "Calendar invitation",
    "calendar-update": "Calendar appointment updated",
    "calendar-cancel": "Calendar appointment cancelled",
  }[template];
  const appointment = validateAppointment(payload.appointment);
  const eventVersion = requiredPositiveInteger(payload, "eventVersion", 1_000_000);
  const attendeeName = optionalString(payload, "attendeeName", { maximum: 200 }).trim();
  const title = singleLine(appointment.title_en || appointment.title_zh, 200);
  const greeting = attendeeName ? `Hello ${attendeeName},` : "Hello,";
  const rows = [
    ["Appointment", title],
    ["Starts", appointment.starts_at],
    ["Ends", appointment.ends_at],
    ["Channel", appointment.channel],
    ["Related to", appointment.related_label || "—"],
    ["Event version", String(eventVersion)],
  ];
  return {
    subject: singleLine(`${action}: ${title}`),
    heading: action,
    bodyHtml: `<p style="line-height:1.7">${escapeHtml(greeting)}</p>${detailTable(rows)}`,
    bodyText: `${greeting}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}`,
  };
}

export function renderTemplate(template, payload, {
  brandName,
  applicationUrl: configuredApplicationUrl,
}) {
  validatePayloadFields(template, payload);
  const appUrl = applicationUrl(configuredApplicationUrl).toString();
  let content;

  if (template === "reminder") {
    const reminderId = requiredString(payload, "reminderId", { maximum: 200 });
    content = {
      subject: "Lumina CRM reminder",
      heading: "Reminder",
      bodyHtml: `<p style="line-height:1.7">You have a reminder waiting in Lumina Education CRM.</p>${detailTable([["Reference", reminderId]])}${actionLink(appUrl, "Open Lumina CRM")}`,
      bodyText: `You have a reminder waiting in Lumina Education CRM.\nReference: ${reminderId}\n\nOpen Lumina CRM: ${appUrl}`,
    };
  } else if (template === "password-reset" || template === "email-verification") {
    const url = internalUrl(requiredString(payload, "url", { maximum: 2_000 }), appUrl);
    const expires = durationLabel(requiredPositiveInteger(payload, "expiresInSeconds"));
    const passwordReset = template === "password-reset";
    content = {
      subject: passwordReset ? "Reset your Lumina CRM password" : "Verify your Lumina CRM email",
      heading: passwordReset ? "Reset your password" : "Verify your email",
      bodyHtml: `<p style="line-height:1.7">This secure link expires in ${escapeHtml(expires)}.</p>${actionLink(url, passwordReset ? "Reset password" : "Verify email")}`,
      bodyText: `This secure link expires in ${expires}.\n\n${passwordReset ? "Reset password" : "Verify email"}: ${url}`,
    };
  } else if (template === "device-verification") {
    const code = requiredString(payload, "code", { maximum: 32 });
    const expires = durationLabel(requiredPositiveInteger(payload, "expiresInSeconds"));
    content = {
      subject: "Your Lumina CRM verification code",
      heading: "Device verification",
      bodyHtml: `<p style="line-height:1.7">Enter this code to continue. It expires in ${escapeHtml(expires)}.</p><p style="padding:16px;border-radius:10px;background:#eef6f3;font-size:28px;font-weight:800;letter-spacing:6px;text-align:center">${escapeHtml(code)}</p>`,
      bodyText: `Enter this code to continue: ${code}\nIt expires in ${expires}.`,
    };
  } else if (template === "staff-account-created") {
    const username = requiredString(payload, "username", { maximum: 160 });
    const temporaryPassword = requiredString(payload, "temporaryPassword", { maximum: 500 });
    const loginUrl = internalUrl(requiredString(payload, "loginUrl", { maximum: 2_000 }), appUrl);
    const displayNameZh = requiredString(payload, "displayNameZh", { maximum: 200, allowEmpty: true });
    const displayNameEn = requiredString(payload, "displayNameEn", { maximum: 200, allowEmpty: true });
    const mustChangePassword = requiredBoolean(payload, "mustChangePassword");
    const mfaRequired = requiredBoolean(payload, "mfaRequired");
    const displayName = displayNameEn.trim() || displayNameZh.trim() || username;
    const instructions = [
      mustChangePassword ? "You must change the temporary password after signing in." : "",
      mfaRequired ? "Multi-factor authentication setup is required for this account." : "",
    ].filter(Boolean).join(" ");
    content = {
      subject: "Your Lumina Education CRM account is ready",
      heading: "Welcome to Lumina Education CRM",
      bodyHtml: `<p style="line-height:1.7">Hello ${escapeHtml(displayName)},</p>${detailTable([["Username", username], ["Temporary password", temporaryPassword]])}<p style="line-height:1.7">${escapeHtml(instructions)}</p>${actionLink(loginUrl, "Sign in")}`,
      bodyText: `Hello ${displayName},\n\nUsername: ${username}\nTemporary password: ${temporaryPassword}\n${instructions}\n\nSign in: ${loginUrl}`,
    };
  } else if (template === "communication-message") {
    const conversationSubject = requiredString(payload, "subject", { maximum: 200 });
    const message = requiredString(payload, "body", { maximum: 10_000 });
    const recipientName = optionalString(payload, "recipientName", { maximum: 200 }).trim();
    const greeting = recipientName ? `Hello ${recipientName},` : "Hello,";
    content = {
      subject: singleLine(`New Lumina CRM message: ${conversationSubject}`),
      heading: singleLine(conversationSubject, 200),
      bodyHtml: `<p style="line-height:1.7">${escapeHtml(greeting)}</p><div style="padding:16px;border-radius:10px;background:#f5f8f7;line-height:1.7;white-space:pre-wrap">${escapeHtml(message)}</div>${actionLink(appUrl, "Open Lumina CRM")}`,
      bodyText: `${greeting}\n\n${message}\n\nOpen Lumina CRM: ${appUrl}`,
    };
  } else {
    content = calendarContent(template, payload);
  }

  const rendered = layout({
    brandName,
    applicationUrl: appUrl,
    heading: content.heading,
    bodyHtml: content.bodyHtml,
    bodyText: content.bodyText,
  });
  return {
    subject: content.subject,
    html: rendered.html,
    text: rendered.text,
  };
}
