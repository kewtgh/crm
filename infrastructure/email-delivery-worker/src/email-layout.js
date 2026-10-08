export function escapeHtml(value) {
  return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}

export const emailParagraph = text => `<p style="margin:0 0 18px;font-size:16px;line-height:1.7;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(text).replaceAll("\n","<br>")}</p>`;
export const emailSecurityNotice = text => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border-top:1px solid #dce5e8"><tr><td class="email-muted" style="padding-top:16px;font-size:13px;line-height:1.6;color:#526575">${escapeHtml(text)}</td></tr></table>`;
export function emailDetailTable(rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;border-collapse:collapse;margin:8px 0 20px">${rows.map(([label,value])=>`<tr><td class="email-muted" width="32%" style="padding:10px 12px 10px 0;vertical-align:top;border-bottom:1px solid #e5ecef;font-size:13px;color:#526575;word-break:break-word">${escapeHtml(label)}</td><td style="padding:10px 0;vertical-align:top;border-bottom:1px solid #e5ecef;font-size:15px;font-weight:600;word-break:break-all;overflow-wrap:anywhere">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}
export function emailCodeBlock(code) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:16px 0 24px;font-family:Consolas,Menlo,monospace;font-size:36px;line-height:1.5;font-weight:bold;letter-spacing:7px;word-break:break-all">${escapeHtml(code)}</td></tr></table>`;
}
export function emailActionButton(url,label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td bgcolor="#176b78" align="center" style="border-radius:6px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 22px;font-size:15px;line-height:1.3;font-weight:bold;color:#ffffff!important;text-decoration:none;border:1px solid #176b78;border-radius:6px">${escapeHtml(label)}</a></td></tr></table>`;
}
export function emailLayout({brandName,applicationUrl,heading,bodyHtml,bodyText,locale="en"}) {
  const origin=new URL(applicationUrl).origin;
  const footer=locale==="zh-CN"?"此邮件由 ewaya CRM 发送。请妥善保管账户与访问凭据。":"Sent by ewaya CRM. Keep account and access credentials private.";
  return {
    html:`<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>@media(prefers-color-scheme:dark){.email-page{background:#15252d!important}.email-card{background:#21343e!important;color:#f3f7f8!important}.email-muted{color:#bdced6!important}}@media(max-width:480px){.email-content{padding:24px 20px!important}}</style></head><body class="email-page" style="margin:0;padding:0;background:#f1f5f7;color:#18313e;font-family:Arial,'Microsoft YaHei',sans-serif;-webkit-text-size-adjust:100%"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:24px 12px"><!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table role="presentation" class="email-card" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;border:1px solid #dae5e9;border-radius:12px;background:#ffffff;color:#18313e"><tr><td style="padding:22px 28px;border-bottom:3px solid #176b78;font-size:22px;font-weight:bold;letter-spacing:.2px">${escapeHtml(brandName)}</td></tr><tr><td class="email-content" style="padding:28px;overflow-wrap:anywhere"><h1 style="margin:0 0 20px;font-size:25px;line-height:1.35;font-weight:bold">${escapeHtml(heading)}</h1>${bodyHtml}</td></tr><tr><td class="email-muted" style="padding:20px 28px;border-top:1px solid #e5ecef;color:#526575;font-size:12px;line-height:1.65">${escapeHtml(footer)}<br><a href="${escapeHtml(origin)}" style="color:#176b78;word-break:break-all">${escapeHtml(origin)}</a></td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`,
    text:`${brandName}\n\n${heading}\n\n${bodyText}\n\n${footer}\n${origin}`,
  };
}
