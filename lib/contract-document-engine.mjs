// Shared Node runtime: no Python/Office dependency, no business writes.
import {createHash} from "node:crypto";
import {crc32, inflateRawSync} from "node:zlib";

export const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const digest = value => createHash("sha256").update(value).digest("hex");
export class DocumentError extends Error {
  constructor(code, fields = []) { super(code); this.code = code; this.fields = fields; }
}
const fail = (code, fields) => { throw new DocumentError(code, fields); };
const token = /\{\{([a-z][a-z0-9_.]*)\}\}/g;
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, key) => key[0] === "#" ? String.fromCodePoint(key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1))) : ({amp:"&",lt:"<",gt:">",quot:'"',apos:"'"})[key]);

export function unzipDocx(bytes) {
  const input = Buffer.from(bytes);
  if (input.length > 8_000_000) fail("TEMPLATE_TOO_LARGE");
  let end = -1;
  for (let i = input.length - 22; i >= Math.max(0, input.length - 65557); i--) if (input.readUInt32LE(i) === 0x06054b50) {end = i; break;}
  if (end < 0 || input.readUInt16LE(end + 4) || input.readUInt16LE(end + 6)) fail("DOCX_ZIP_INVALID");
  let offset = input.readUInt32LE(end + 16), total = 0;
  const entries = [];
  for (let n = 0; n < input.readUInt16LE(end + 10); n++) {
    if (offset + 46 > input.length || input.readUInt32LE(offset) !== 0x02014b50) fail("DOCX_ZIP_INVALID");
    const flags = input.readUInt16LE(offset + 8), method = input.readUInt16LE(offset + 10);
    const length = input.readUInt32LE(offset + 20), expanded = input.readUInt32LE(offset + 24);
    const nameLength = input.readUInt16LE(offset + 28), extra = input.readUInt16LE(offset + 30), comment = input.readUInt16LE(offset + 32);
    const name = input.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"), local = input.readUInt32LE(offset + 42);
    if (flags & 1 || ![0,8].includes(method) || /(^\/|\.\.|\\)/.test(name) || entries.some(e => e.name === name)) fail("DOCX_ZIP_INVALID");
    if (local + 30 > input.length || input.readUInt32LE(local) !== 0x04034b50) fail("DOCX_ZIP_INVALID");
    total += expanded;
    if (total > 32_000_000 || entries.length > 1000) fail("DOCX_EXPANSION_LIMIT");
    const start = local + 30 + input.readUInt16LE(local + 26) + input.readUInt16LE(local + 28);
    if (start + length > input.length) fail("DOCX_ZIP_INVALID");
    const compressed = input.subarray(start, start + length);
    const data = method === 8 ? inflateRawSync(compressed, {maxOutputLength: Math.max(1, expanded)}) : compressed;
    if (data.length !== expanded || crc32(data) !== input.readUInt32LE(offset + 16)) fail("DOCX_ZIP_INVALID");
    entries.push({name, data});
    offset += 46 + nameLength + extra + comment;
  }
  if (!entries.some(e => e.name === "word/document.xml") || !entries.some(e => e.name === "[Content_Types].xml")) fail("DOCX_CONTENT_MISSING");
  return entries;
}

export function zipDocx(entries) {
  // STORED ZIP, sorted names, fixed DOS date: equal input -> equal output bytes.
  const locals = [], central = []; let offset = 0;
  for (const entry of [...entries].sort((a,b) => a.name.localeCompare(b.name, "en"))) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data), crc = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4);
    header.writeUInt16LE(0x800,6); header.writeUInt16LE(33,12); header.writeUInt32LE(crc,14);
    header.writeUInt32LE(data.length,18); header.writeUInt32LE(data.length,22); header.writeUInt16LE(name.length,26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20,4); c.writeUInt16LE(20,6);
    c.writeUInt16LE(0x800,8); c.writeUInt16LE(33,14); c.writeUInt32LE(crc,16); c.writeUInt32LE(data.length,20);
    c.writeUInt32LE(data.length,24); c.writeUInt16LE(name.length,28); c.writeUInt32LE(offset,42);
    locals.push(header, name, data); central.push(c, name); offset += header.length + name.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals, directory, end]);
}

function validateXml(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("DOCX_XML_UNSAFE");
  const stack = [];
  for (const match of xml.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>/g)) {
    const raw = match[0]; if (/^<(!|\?)/.test(raw)) continue;
    const name = /^<\/?([\w:.-]+)/.exec(raw)?.[1]; if (!name) fail("DOCX_XML_INVALID");
    if (raw.startsWith("</")) {if (stack.pop() !== name) fail("DOCX_XML_INVALID");}
    else if (!raw.endsWith("/>")) stack.push(name);
  }
  if (stack.length) fail("DOCX_XML_INVALID");
}
function paragraphText(xml) { return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => decode(m[1])).join(""); }

export function lintDocx(version, bytes) {
  if (digest(bytes) !== version.template_sha256) fail("TEMPLATE_CHECKSUM_MISMATCH");
  const fields = version.fields ?? [], keys = new Set(fields.map(f => f.key));
  if (!fields.length || keys.size !== fields.length || fields.some(f => f.allow_override !== false)) fail("TEMPLATE_SCHEMA_INVALID");
  const used = new Set();
  const entries = unzipDocx(bytes);
  for (const entry of entries) {
    if (!/\.(xml|rels)$/.test(entry.name)) continue;
    const xml = entry.data.toString("utf8"); validateXml(xml);
    for (const paragraph of xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
      const text = paragraphText(paragraph[0]);
      for (const match of text.matchAll(token)) {if (!keys.has(match[1])) fail("UNKNOWN_PLACEHOLDER", [match[1]]); used.add(match[1]);}
      if (/\{\{|\}\}/.test(text.replace(token, ""))) fail("MALFORMED_PLACEHOLDER");
    }
    if (/vbaProject|TargetMode="External"/.test(xml)) fail("DOCX_EXTERNAL_CONTENT_UNSUPPORTED");
  }
  for (const f of fields) if (f.required === true && !used.has(f.key)) fail("UNUSED_REQUIRED_FIELD", [f.key]);
  return entries;
}

export function money(value) {
  const text = String(value ?? "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(text)) fail("INVALID_MONEY");
  const [whole, fraction = ""] = text.split(".");
  return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
}
export function amountWords(value, currency) {
  const amount = money(value);
  if (currency !== "CNY") return `${currency} ${amount}`;
  const digits = "零壹贰叁肆伍陆柒捌玖", units = ["", "拾", "佰", "仟"], groupUnits = ["", "万", "亿"];
  const [whole, fraction] = amount.split("."); let result = "", pendingZero = false;
  const groups = []; for (let n = BigInt(whole); n > 0n; n /= 10000n) groups.push(Number(n % 10000n));
  for (let g = groups.length - 1; g >= 0; g--) {
    const number = groups[g]; if (!number) {pendingZero = !!result; continue;}
    if (result && (pendingZero || number < 1000)) result += "零";
    let section = "", zero = false;
    for (let u = 3; u >= 0; u--) {const d = Math.floor(number / 10 ** u) % 10; if (!d) {zero = !!section; continue;} if (zero) section += "零"; section += digits[d] + units[u]; zero = false;}
    result += section + groupUnits[g]; pendingZero = false;
  }
  result = `人民币${result || "零"}元`;
  if (fraction === "00") return result + "整";
  if (fraction[0] !== "0") result += digits[Number(fraction[0])] + "角";
  else if (whole !== "0" && fraction[1] !== "0") result += "零";
  if (fraction[1] !== "0") result += digits[Number(fraction[1])] + "分";
  return result;
}
function validDate(value) {return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;}
const staticField = (key,version) => key.startsWith("company.") || version.template_key === "student-program" && key.startsWith("bank.");
export function resolveDocumentFields(version, context, confirmed, approvedStatic = {}, actor = {}) {
  if (!confirmed || Array.isArray(confirmed) || typeof confirmed !== "object") fail("CONFIRMATIONS_INVALID");
  const allowed = new Set(version.fields.filter(f => f.category === "USER_CONFIRMED" && !staticField(f.key,version)).map(f => f.key));
  for (const key of Object.keys(confirmed)) if (!allowed.has(key)) fail("FIELD_OVERRIDE_FORBIDDEN", [key]);
  const values = {}, evidence = [], issues = [];
  for (const field of version.fields) {
    const key = field.key, category = field.category;
    const source = staticField(key,version) ? approvedStatic : category === "CANONICAL" ? context.canonical : confirmed;
    let value = category === "TEMPLATE_CONSTANT" ? field.value : category === "DERIVED" ? null : source?.[key];
    const guardianInactive = key.startsWith("guardian.") && key !== "guardian.required" && confirmed["guardian.required"] === false;
    const required = field.required === true || field.required_if && confirmed[field.required_if.field] === field.required_if.equals;
    if (category === "UNSUPPORTED") {issues.push({key, code:"UNSUPPORTED_FIELD"}); values[key] = `【UNSUPPORTED / 待业务审阅: ${key}】`; continue;}
    if (category === "DERIVED") {if (key !== "contract.amount_words") fail("DERIVATION_UNSUPPORTED", [key]); try {value = amountWords(context.canonical["contract.amount"], context.canonical["contract.currency"]);} catch {value = null;}}
    if (guardianInactive) value = "不适用（已明确确认） / Not applicable (confirmed)";
    if (value == null || value === "") {
      if (required) issues.push({key, code:"MISSING_REQUIRED_FIELD"});
      values[key] = required ? `【缺少 / Missing: ${field.label_zh || key} / ${key}】` : "不适用 / Not applicable";
      continue;
    }
    if (!guardianInactive) {
      if (field.type === "boolean") {if (typeof value !== "boolean") fail("FIELD_VALIDATION_FAILED", [key]);}
      else if (typeof value !== "string" && field.type !== "money") fail("FIELD_VALIDATION_FAILED", [key]);
      const text = String(value);
      if (text.length > 5000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]|\{\{|\}\}/.test(text)) fail("FIELD_VALIDATION_FAILED", [key]);
      if (field.type === "date" && !validDate(text) || field.type === "currency" && !/^[A-Z]{3}$/.test(text)) fail("FIELD_VALIDATION_FAILED", [key]);
      if (field.type === "money") value = money(value);
    }
    const display = field.type === "money" ? String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : field.type === "boolean" ? value ? "是 / Yes" : "否 / No" : String(value);
    values[key] = display;
    evidence.push({field_key:key, category, resolved_value:value, display_value:display, source_path:field.source_path,
      source_kind:staticField(key,version) ? "APPROVED_WORKSPACE_CONFIGURATION" : field.source,
      source_id:staticField(key,version) ? actor.configurationId ?? null : category === "USER_CONFIRMED" ? actor.id ?? null : ({PRODUCT:context.references?.productId, COHORT:context.references?.cohortId, HOUSEHOLD:context.references?.householdId, STUDENT_CONTACT:context.references?.contactId, ORGANIZATION:context.references?.organizationId, CHANNEL_AGREEMENT:context.references?.agreementId, AGREEMENT_VERSION:context.references?.agreementVersionId, COMMISSION_RULE:context.references?.commissionRuleId})[field.source] ?? context.sourceId, source_revision:field.source === "CUSTOMER_CONTRACT" || field.source === "AGREEMENT_VERSION" ? context.sourceRevision : null,
      ...(category === "USER_CONFIRMED" ? {confirmed_by: staticField(key,version) ? actor.configurationApprovedBy : actor.id,
        confirmed_at:staticField(key,version) ? actor.configurationApprovedAt : actor.at} : {})});
  }
  const amount = context.canonical?.["contract.amount"];
  if (amount && confirmed["service.program_component"] && confirmed["service.logistics_component"]) {
    const cents = value => BigInt(money(value).replace(".", ""));
    if (cents(amount) !== cents(confirmed["service.program_component"]) + cents(confirmed["service.logistics_component"])) fail("FEE_COMPONENT_MISMATCH");
  }
  for (const [start,end] of [["program.start_on","program.end_on"],["agreement.effective_from","agreement.effective_to"]]) if (values[start] && values[end] && validDate(values[start]) && validDate(values[end]) && values[start] > values[end]) fail("DATE_RANGE_INVALID");
  return {values,evidence,issues};
}
export function productionEligibility(version, activeVersion, issues) {
  if (version.status !== "APPROVED" || activeVersion !== version.version_number || !version.approved_by || !version.approved_at) fail("TEMPLATE_NOT_APPROVED");
  if ((version.review_items ?? []).length || issues.length) fail("GENERATION_BLOCKED", issues);
}
function replaceParagraph(xml, values) {
  const nodes = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => ({offset:m.index, raw:m[0], text:decode(m[1])}));
  let position = 0; for (const node of nodes) {node.start = position; position += node.text.length;}
  const text = nodes.map(n => n.text).join("");
  for (const match of [...text.matchAll(token)].reverse()) {
    const selected = nodes.filter(n => n.start < match.index + match[0].length && n.start + n.text.length > match.index);
    selected.forEach((n,i) => { n.text = n.text.slice(0,Math.max(0,match.index-n.start)) + (i === 0 ? values[match[1]] : "") + n.text.slice(Math.max(0,match.index+match[0].length-n.start)); });
  }
  for (const node of [...nodes].reverse()) {
    const opening = node.raw.slice(0,node.raw.indexOf(">")+1);
    const replacement = opening.replace(/\s+xml:space="[^"]*"/, "").replace(/>$/, ' xml:space="preserve">') + node.text.split("\n").map(escape).join('</w:t><w:br/><w:t xml:space="preserve">') + "</w:t>";
    xml = xml.slice(0,node.offset) + replacement + xml.slice(node.offset + node.raw.length);
  }
  return xml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, run => {
    if (!/【缺少|【UNSUPPORTED/.test(run)) return run;
    if (/<w:color\b/.test(run)) return run.replace(/<w:color\b[^>]*\/>/, '<w:color w:val="C00000"/>');
    return run.includes("</w:rPr>") ? run.replace("</w:rPr>", '<w:color w:val="C00000"/></w:rPr>') : run.replace(/^(<w:r\b[^>]*>)/, '$1<w:rPr><w:color w:val="C00000"/></w:rPr>');
  });
}
export function renderDocx(version, bytes, values) {
  const entries = lintDocx(version, bytes);
  for (const entry of entries) if (/\.xml$/.test(entry.name)) {
    const xml = entry.data.toString("utf8").replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, p => replaceParagraph(p, values));
    if (/\{\{|\}\}/.test(paragraphText(xml))) fail("PLACEHOLDER_LEFTOVER");
    validateXml(xml); entry.data = Buffer.from(xml);
  }
  return zipDocx(entries);
}
export function documentFilename(reference, version) {
  const safe = String(reference).replace(/[^\p{L}\p{N}_-]/gu,"-").slice(0,70) || "Document";
  return `Contract-${safe}-v${version}.docx`;
}
export function verifyDocumentArtifact(bytes,lineage) {
  return !!bytes && bytes.byteLength===lineage.bytes && digest(bytes)===lineage.sha256;
}
