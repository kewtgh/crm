import {emailLayout, emailParagraph, emailDetailTable, emailCodeBlock, emailActionButton, emailSecurityNotice} from "./email-layout.js";

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
    optionalPayloadFields: Object.freeze(["locale"]),
  }),
  "device-verification": Object.freeze({
    requiredPayloadFields: Object.freeze(["code", "expiresInSeconds"]),
    optionalPayloadFields: Object.freeze(["locale"]),
  }),
  "email-verification": Object.freeze({
    requiredPayloadFields: Object.freeze(["url", "expiresInSeconds"]),
    optionalPayloadFields: Object.freeze(["locale"]),
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
    optionalPayloadFields: Object.freeze(["locale"]),
  }),
  "communication-message": Object.freeze({
    requiredPayloadFields: Object.freeze(["subject", "body"]),
    optionalPayloadFields: Object.freeze(["recipientName", "locale"]),
  }),
  "calendar-invite": Object.freeze({
    requiredPayloadFields: Object.freeze(["eventVersion", "appointment"]),
    optionalPayloadFields: Object.freeze(["attendeeName", "locale"]),
  }),
  "calendar-update": Object.freeze({
    requiredPayloadFields: Object.freeze(["eventVersion", "appointment"]),
    optionalPayloadFields: Object.freeze(["attendeeName", "locale"]),
  }),
  "calendar-cancel": Object.freeze({
    requiredPayloadFields: Object.freeze(["eventVersion", "appointment"]),
    optionalPayloadFields: Object.freeze(["attendeeName", "locale"]),
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

export function renderTemplate(template, payload, {brandName, applicationUrl: configuredApplicationUrl}) {
  validatePayloadFields(template,payload);
  const appUrl=applicationUrl(configuredApplicationUrl).toString();
  const zh=payload.locale==="zh-CN", locale=zh?"zh-CN":"en";
  const tr=(en,cn)=>zh?cn:en;
  const greeting=name=>name?tr(`Hello ${name},`,`${name}，您好！`):tr("Hello,","您好！");
  const security=tr("If you did not request this, do not share the code or follow the link. Contact your administrator.","如非本人操作，请勿分享验证码或访问链接，并联系管理员。");
  let heading,subject,html="",text="";
  const paragraph=value=>{html+=emailParagraph(value);text+=value+"\n\n";};
  const details=rows=>{html+=emailDetailTable(rows);text+=rows.map(([key,value])=>`${key}: ${value}`).join("\n")+"\n\n";};
  const action=(url,label)=>{html+=emailActionButton(url,label);text+=`${label}: ${url}\n\n`;};
  const notice=value=>{html+=emailSecurityNotice(value);text+=value+"\n\n";};
  const duration=seconds=>zh?(seconds%3600===0?`${seconds/3600} 小时`:seconds%60===0?`${seconds/60} 分钟`:`${seconds} 秒`):durationLabel(seconds);
  if(template==="reminder") {
    const id=requiredString(payload,"reminderId",{maximum:200});
    heading=tr("Reminder","工作提醒");subject=tr("ewaya CRM reminder","ewaya CRM 工作提醒");
    paragraph(tr("You have a reminder waiting in ewaya CRM.","您在 ewaya CRM 中有一项待处理提醒。"));details([[tr("Reference","参考编号"),id]]);action(appUrl,tr("Open ewaya CRM","打开 ewaya CRM"));
  } else if(template==="password-reset"||template==="email-verification") {
    const url=internalUrl(requiredString(payload,"url",{maximum:2000}),appUrl),expires=duration(requiredPositiveInteger(payload,"expiresInSeconds")),reset=template==="password-reset";
    heading=reset?tr("Reset your password","重置密码"):tr("Verify your email","验证邮箱");subject=reset?tr("Reset your ewaya CRM password","重置您的 ewaya CRM 密码"):tr("Verify your ewaya CRM email","验证您的 ewaya CRM 邮箱");
    paragraph(tr(`This secure link expires in ${expires}.`,`此安全链接将在 ${expires} 后失效。`));action(url,reset?tr("Reset password","重置密码"):tr("Verify email","验证邮箱"));notice(security);
  } else if(template==="device-verification") {
    const code=requiredString(payload,"code",{maximum:32}),expires=duration(requiredPositiveInteger(payload,"expiresInSeconds"));
    heading=tr("Device verification","设备验证");subject=tr("Your ewaya CRM verification code","您的 ewaya CRM 验证码");
    paragraph(tr(`Enter this code to continue. It expires in ${expires}.`,`请填写以下验证码继续登录。验证码将在 ${expires} 后失效。`));html+=emailCodeBlock(code);text+=code+"\n\n";notice(security);
  } else if(template==="staff-account-created") {
    const username=requiredString(payload,"username",{maximum:160}),temporary=requiredString(payload,"temporaryPassword",{maximum:500}),url=internalUrl(requiredString(payload,"loginUrl",{maximum:2000}),appUrl);
    const nameZh=requiredString(payload,"displayNameZh",{maximum:200,allowEmpty:true}),nameEn=requiredString(payload,"displayNameEn",{maximum:200,allowEmpty:true});
    const mustChange=requiredBoolean(payload,"mustChangePassword"),mfa=requiredBoolean(payload,"mfaRequired");
    heading=tr("Welcome to ewaya CRM","欢迎使用 ewaya CRM");subject=tr("Your ewaya CRM account is ready","您的 ewaya CRM 账号已创建");
    paragraph(greeting((zh?nameZh||nameEn:nameEn||nameZh)||username));details([[tr("Username","账户名"),username],[tr("Temporary password","临时密码"),temporary]]);
    if(mustChange)paragraph(tr("You must change the temporary password after signing in.","首次登录后必须立即更换临时密码。"));
    if(mfa)paragraph(tr("Multi-factor authentication setup is required for this account.","此账号必须配置多因素验证。"));action(url,tr("Sign in","登录"));notice(tr("Keep this invitation private. Do not forward your temporary credentials.","请妥善保管此邀请，不要转发临时凭据。"));
  } else if(template==="communication-message") {
    const title=requiredString(payload,"subject",{maximum:200}),message=requiredString(payload,"body",{maximum:10000}),name=optionalString(payload,"recipientName",{maximum:200}).trim();
    heading=singleLine(title,200);subject=singleLine(tr(`New ewaya CRM message: ${title}`,`ewaya CRM 新消息：${title}`));paragraph(greeting(name));paragraph(message);action(appUrl,tr("Open ewaya CRM","打开 ewaya CRM"));
  } else {
    const appointment=validateAppointment(payload.appointment),version=requiredPositiveInteger(payload,"eventVersion",1000000),name=optionalString(payload,"attendeeName",{maximum:200}).trim();
    heading=({"calendar-invite":tr("Calendar invitation","日程邀请"),"calendar-update":tr("Calendar appointment updated","日程已更新"),"calendar-cancel":tr("Calendar appointment cancelled","日程已取消")})[template];
    const title=singleLine((zh?appointment.title_zh||appointment.title_en:appointment.title_en||appointment.title_zh),200);subject=singleLine(`${heading}: ${title}`);paragraph(greeting(name));
    details([[tr("Appointment","日程"),title],[tr("Starts","开始时间"),appointment.starts_at],[tr("Ends","结束时间"),appointment.ends_at],[tr("Channel","方式"),appointment.channel],[tr("Related to","关联事项"),appointment.related_label||"—"],[tr("Event version","日程版本"),String(version)]]);
  }
  const rendered=emailLayout({brandName,applicationUrl:appUrl,heading,bodyHtml:html,bodyText:text.trim(),locale});
  return {subject,html:rendered.html,text:rendered.text};
}
