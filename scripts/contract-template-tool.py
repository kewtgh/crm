"""Offline DOCX template lint / synthetic preview. No DB, network or production generation."""
from __future__ import annotations

import argparse
import copy
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import re
from typing import Literal, TypedDict
from xml.dom import minidom
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "templates/contracts/catalog.json"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
TOKEN = re.compile(r"\{\{([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)\}\}")
TYPES = {"CHANNEL_RECRUITMENT_AGREEMENT", "STUDENT_PROGRAM_SERVICE_AGREEMENT"}
CATEGORIES = {"CANONICAL", "USER_CONFIRMED", "TEMPLATE_CONSTANT", "DERIVED", "UNSUPPORTED"}


class Field(TypedDict):
    key: str
    category: Literal["CANONICAL", "USER_CONFIRMED", "TEMPLATE_CONSTANT", "DERIVED", "UNSUPPORTED"]
    type: Literal["text", "date", "money", "currency", "boolean"]
    required: bool
    allow_override: bool
    sensitive: bool
    source: str
    source_path: str
    label_zh: str
    label_en: str


class TemplateError(ValueError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_catalog() -> dict:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    identities = {item["template_key"]: item for item in catalog["templates"]}
    if len(identities) != len(catalog["templates"]):
        raise TemplateError("DUPLICATE_TEMPLATE_IDENTITY")
    seen = set()
    for version in catalog["versions"]:
        identity = identities.get(version["template_key"])
        key = (version["template_key"], version["version_number"])
        if identity is None or identity["contract_type"] != version["contract_type"] or key in seen:
            raise TemplateError("INVALID_TEMPLATE_VERSION_IDENTITY")
        seen.add(key)
        validate_schema(version)
    for key, identity in identities.items():
        active = identity.get("active_version_number")
        if active is not None and not any(v["template_key"] == key and v["version_number"] == active
                                          and v["status"] == "APPROVED" for v in catalog["versions"]):
            raise TemplateError("ACTIVE_VERSION_MUST_BE_APPROVED")
    return catalog


def decimal_amount(value: object) -> Decimal:
    if not isinstance(value, str) or not re.fullmatch(r"\d{1,12}(?:\.\d{1,2})?", value):
        raise TemplateError("INVALID_MONEY")
    try:
        result = Decimal(value)
    except InvalidOperation as error:
        raise TemplateError("INVALID_MONEY") from error
    return result.quantize(Decimal("0.01"))


def date_text(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise TemplateError("INVALID_DATE")
    try:
        return dt.date.fromisoformat(value).strftime("%Y年%m月%d日")
    except ValueError as error:
        raise TemplateError("INVALID_DATE") from error


def amount_words(amount: object, currency: object) -> str:
    value = decimal_amount(amount)
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Z]{3}", currency):
        raise TemplateError("INVALID_CURRENCY")
    if currency != "CNY":
        return f"{currency} {value:,.2f}"
    digits = "零壹贰叁肆伍陆柒捌玖"

    def group(number: int) -> str:
        result = ""
        pending_zero = False
        for divisor, unit in [(1000, "仟"), (100, "佰"), (10, "拾"), (1, "")]:
            n, number = divmod(number, divisor)
            if n:
                if pending_zero and result:
                    result += "零"
                result += digits[n] + unit
                pending_zero = False
            elif result:
                pending_zero = True
        return result

    integer = int(value)
    groups = [(integer // 100000000, "亿"), ((integer // 10000) % 10000, "万"), (integer % 10000, "")]
    text = ""
    pending_zero = False
    for number, unit in groups:
        if number:
            if text and (pending_zero or number < 1000):
                text += "零"
            text += group(number) + unit
            pending_zero = False
        elif text:
            pending_zero = True
    text = text or "零"
    cents = int((value - integer) * 100)
    jiao, fen = divmod(cents, 10)
    fraction = (digits[jiao] + "角" if jiao else "") + (digits[fen] + "分" if fen else "")
    if fen and not jiao and integer:
        fraction = "零" + fraction
    return "人民币" + text + "元" + (fraction or "整")


def document_parts(data: bytes) -> dict[str, bytes]:
    import io
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return {info.filename: archive.read(info.filename) for info in archive.infolist()}


def xml_parts(parts: dict[str, bytes]):
    return [(name, content) for name, content in parts.items()
            if name == "word/document.xml" or re.fullmatch(r"word/(?:header|footer)\d+\.xml", name)]


def paragraph_text(paragraph) -> str:
    return "".join(node.firstChild.data if node.firstChild else ""
                   for node in paragraph.getElementsByTagNameNS(W, "t"))


def validate_schema(version: dict) -> None:
    if version.get("contract_type") not in TYPES or version.get("status") not in {"DRAFT", "APPROVED", "RETIRED"}:
        raise TemplateError("INVALID_TEMPLATE_TYPE_OR_STATUS")
    if not isinstance(version.get("version_number"), int) or version["version_number"] < 1:
        raise TemplateError("INVALID_VERSION")
    if not re.fullmatch(r"[a-f0-9]{64}", version.get("source_sha256", "")):
        raise TemplateError("INVALID_REFERENCE_CHECKSUM")
    if "forbidden_literals" in version:
        raise TemplateError("PLAINTEXT_REFERENCE_GUARD_NOT_ALLOWED")
    guards = version.get("forbidden_literal_digests")
    if not isinstance(guards, list) or not guards:
        raise TemplateError("INVALID_REFERENCE_GUARD")
    for guard in guards:
        if (not isinstance(guard, dict)
                or not isinstance(guard.get("sha256"), str)
                or not re.fullmatch(r"[a-f0-9]{64}", guard["sha256"])
                or type(guard.get("characters")) is not int
                or not 1 <= guard["characters"] <= 256):
            raise TemplateError("INVALID_REFERENCE_GUARD")
    seen = set()
    for field in version["fields"]:
        if field["key"] in seen:
            raise TemplateError("DUPLICATE_FIELD")
        seen.add(field["key"])
        if not TOKEN.fullmatch("{{" + field["key"] + "}}") or field["category"] not in CATEGORIES:
            raise TemplateError("INVALID_FIELD_SCHEMA")
        if field["type"] not in {"text", "date", "money", "currency", "boolean"}:
            raise TemplateError("INVALID_FIELD_TYPE")
        for key in ["required", "sensitive", "allow_override"]:
            if not isinstance(field.get(key), bool):
                raise TemplateError("INVALID_FIELD_FLAGS")
        if field["allow_override"] or field.get("fallback") != "BLOCK_REQUIRED_OR_EXPLICIT_NOT_APPLICABLE":
            raise TemplateError("OVERRIDE_OR_SILENT_FALLBACK_NOT_ALLOWED")
        if not field.get("source") or not field.get("source_path") or not field.get("validation"):
            raise TemplateError("MISSING_FIELD_MAPPING")
        condition = field.get("required_if")
        if condition and (condition.get("field") not in {f["key"] for f in version["fields"]}):
            raise TemplateError("INVALID_REQUIRED_CONDITION")


def lint(version: dict, data: bytes) -> dict:
    validate_schema(version)
    if sha256(data) != version["template_sha256"]:
        raise TemplateError("TEMPLATE_CHECKSUM_CHANGED")
    parts = document_parts(data)
    if "word/document.xml" not in parts or "[Content_Types].xml" not in parts:
        raise TemplateError("INVALID_DOCX")
    # Parse every XML part, not only the visible body.
    package_text = []
    for name, content in parts.items():
        if name.endswith((".xml", ".rels")):
            parsed = minidom.parseString(content)
            for element in parsed.getElementsByTagName("*"):
                package_text.extend(node.data for node in element.childNodes
                                    if node.nodeType in {node.TEXT_NODE, node.CDATA_SECTION_NODE})
                package_text.extend(element.attributes.item(i).value
                                    for i in range(element.attributes.length))
    found = set()
    text = ""
    for _, content in xml_parts(parts):
        doc = minidom.parseString(content)
        for paragraph in doc.getElementsByTagNameNS(W, "p"):
            chunk = paragraph_text(paragraph)
            text += chunk + "\n"
            found.update(TOKEN.findall(chunk))
            if "{{" in TOKEN.sub("", chunk) or "}}" in TOKEN.sub("", chunk):
                raise TemplateError("MALFORMED_PLACEHOLDER")
    fields = {field["key"] for field in version["fields"]}
    if found - fields:
        raise TemplateError("UNKNOWN_PLACEHOLDER:" + ",".join(sorted(found - fields)))
    if any(field["required"] and field["key"] not in found for field in version["fields"]):
        raise TemplateError("UNUSED_REQUIRED_FIELD")
    # Keep reference-residue detection without publishing private reference values.
    # Character counts use Unicode code points, matching Python substring semantics.
    guards_by_length: dict[int, set[str]] = {}
    for guard in version["forbidden_literal_digests"]:
        guards_by_length.setdefault(guard["characters"], set()).add(guard["sha256"])
    residue_text = text + "\n" + "\n".join(package_text)
    for length, digests in guards_by_length.items():
        for offset in range(max(0, len(residue_text) - length + 1)):
            if sha256(residue_text[offset:offset + length].encode("utf-8")) in digests:
                raise TemplateError("PRIVATE_TEMPLATE_RESIDUE_DETECTED")
    if version["status"] == "DRAFT" and "DRAFT" not in text:
        raise TemplateError("MISSING_DRAFT_NOTICE")
    return {"template_key": version["template_key"], "version": version["version_number"],
            "checksum": sha256(data), "fields": len(found), "status": "PASS"}


def resolve_fields(version: dict, fixture: dict) -> tuple[dict[str, str], list[dict]]:
    canonical = fixture.get("canonical", {})
    confirmed = fixture.get("confirmed", {})
    definitions = {field["key"]: field for field in version["fields"]}
    if (set(canonical) | set(confirmed)) - set(definitions):
        raise TemplateError("UNKNOWN_INPUT_FIELD")
    for key in confirmed:
        if definitions[key]["category"] in {"CANONICAL", "DERIVED", "TEMPLATE_CONSTANT"}:
            raise TemplateError("CANONICAL_OVERRIDE_NOT_ALLOWED:" + key)
    for key in canonical:
        if definitions[key]["category"] != "CANONICAL":
            raise TemplateError("INPUT_PROVENANCE_MISMATCH:" + key)
    values = {**canonical, **confirmed}
    rendered = {}
    issues = []
    for field in version["fields"]:
        key = field["key"]
        if field["category"] == "TEMPLATE_CONSTANT":
            value = field.get("value")
        elif field["category"] == "DERIVED":
            value = (amount_words(values["contract.amount"], values["contract.currency"])
                     if values.get("contract.amount") and values.get("contract.currency") else None)
        else:
            value = values.get(key)
        condition = field.get("required_if")
        required = field["required"] or bool(condition and values.get(condition["field"]) == condition["equals"])
        if condition and not required and condition["field"] in values:
            rendered[key] = "不适用（已明确确认） / Not applicable (confirmed)"
            continue
        if value is None or value == "":
            if required:
                issues.append({"code": "MISSING_REQUIRED_FIELD", "field": key})
            rendered[key] = "【缺少 / Missing: " + field["label_zh"] + " / " + field["label_en"] + "】"
            continue
        if field["type"] == "date":
            display = date_text(value)
        elif field["type"] == "money":
            display = f"{decimal_amount(value):,.2f}"
        elif field["type"] == "currency":
            if not isinstance(value, str) or not re.fullmatch(r"[A-Z]{3}", value):
                raise TemplateError("INVALID_CURRENCY")
            display = value
        elif field["type"] == "boolean":
            if not isinstance(value, bool):
                raise TemplateError("INVALID_BOOLEAN")
            display = "是 / Yes" if value else "否 / No"
        else:
            if not isinstance(value, str) or len(value) > field.get("max_length", 5000) or "{{" in value or "}}" in value:
                raise TemplateError("INVALID_TEXT")
            if any(ord(char) < 32 and char not in "\n\t" for char in value):
                raise TemplateError("INVALID_TEXT_CONTROL_CHARACTER")
            display = value
        if field["category"] == "UNSUPPORTED":
            issues.append({"code": field["unsupported_semantics"], "field": key})
            display = "【UNSUPPORTED / 待业务审阅】" + display
        rendered[key] = display
    for start, end in version.get("date_pairs", []):
        if values.get(start) and values.get(end) and values[end] < values[start]:
            raise TemplateError("DATE_ORDER_INVALID")
    if version["contract_type"] == "STUDENT_PROGRAM_SERVICE_AGREEMENT":
        keys = ["service.program_component", "service.logistics_component", "contract.amount"]
        if all(values.get(key) is not None for key in keys):
            if decimal_amount(values[keys[0]]) + decimal_amount(values[keys[1]]) != decimal_amount(values[keys[2]]):
                raise TemplateError("FEE_COMPONENTS_DO_NOT_MATCH_CONTRACT")
    if version["contract_type"] == "CHANNEL_RECRUITMENT_AGREEMENT":
        if fixture.get("source_context", {}).get("commission_basis") != "FIXED_PER_ENROLLMENT":
            issues.append({"code": "UNSUPPORTED_COMMISSION_BASIS", "field": "commission.amount"})
    return rendered, issues


def generation_eligibility(version: dict, issues: list[dict]) -> list[str]:
    blockers = []
    if version["status"] != "APPROVED":
        blockers.append("TEMPLATE_NOT_APPROVED")
    if not version.get("approved_by") or not version.get("approved_at") or not version.get("approval_reference"):
        blockers.append("MISSING_TEMPLATE_APPROVAL_EVIDENCE")
    if version.get("review_items"):
        blockers.append("REQUIRES_BUSINESS_OR_LEGAL_REVIEW")
    blockers.extend(issue["code"] for issue in issues)
    return sorted(set(blockers))


def assert_version_change(before: dict, after: dict) -> None:
    if before["template_key"] != after["template_key"] or before["contract_type"] != after["contract_type"]:
        raise TemplateError("TEMPLATE_IDENTITY_IMMUTABLE")
    if after["version_number"] == before["version_number"]:
        if before["status"] in {"APPROVED", "RETIRED"} or before.get("used_document_count", 0):
            # Retirement changes governance state only; immutable content stays byte-identical.
            a, b = copy.deepcopy(before), copy.deepcopy(after)
            for item in (a, b):
                item.pop("status", None)
            if a != b or not (before["status"] == after["status"] or
                              before["status"] == "APPROVED" and after["status"] == "RETIRED"):
                raise TemplateError("TEMPLATE_VERSION_IMMUTABLE")
    elif after["version_number"] != before["version_number"] + 1 or after["status"] != "DRAFT":
        raise TemplateError("NEW_DRAFT_VERSION_REQUIRED")


def set_text(node, value: str) -> None:
    while node.firstChild:
        node.removeChild(node.firstChild)
    node.setAttribute("xml:space", "preserve")
    pieces = value.split("\n")
    node.appendChild(node.ownerDocument.createTextNode(pieces[0]))
    current = node
    for piece in pieces[1:]:
        br = node.ownerDocument.createElementNS(W, "w:br")
        next_text = node.ownerDocument.createElementNS(W, "w:t")
        next_text.setAttribute("xml:space", "preserve")
        next_text.appendChild(node.ownerDocument.createTextNode(piece))
        current.parentNode.insertBefore(br, current.nextSibling)
        current.parentNode.insertBefore(next_text, br.nextSibling)
        current = next_text


def replace_paragraph_tokens(paragraph, rendered: dict[str, str]) -> None:
    # Locate in concatenated text, then edit only intersecting text nodes. Works across runs.
    for match in reversed(list(TOKEN.finditer(paragraph_text(paragraph)))):
        nodes = list(paragraph.getElementsByTagNameNS(W, "t"))
        position = 0
        intersecting = []
        for node in nodes:
            text = node.firstChild.data if node.firstChild else ""
            stop = position + len(text)
            if position < match.end() and stop > match.start():
                intersecting.append((node, text, position))
            position = stop
        for i, (node, text, start) in enumerate(intersecting):
            left = text[:max(0, match.start() - start)]
            right = text[max(0, match.end() - start):]
            set_text(node, left + (rendered[match.group(1)] if i == 0 else "") + right)
            if i == 0 and rendered[match.group(1)].startswith(("【UNSUPPORTED", "【缺少")):
                run = node.parentNode
                properties = next((child for child in run.childNodes if child.localName == "rPr"), None)
                if properties is None:
                    properties = node.ownerDocument.createElementNS(W, "w:rPr")
                    run.insertBefore(properties, run.firstChild)
                colors = list(properties.getElementsByTagNameNS(W, "color"))
                color = colors[0] if colors else node.ownerDocument.createElementNS(W, "w:color")
                color.setAttribute("w:val", "C00000")
                if not colors:
                    properties.appendChild(color)


def preview(version: dict, data: bytes, fixture: dict) -> tuple[bytes, dict]:
    import io
    if fixture.get("synthetic") is not True:
        raise TemplateError("SYNTHETIC_FIXTURE_REQUIRED")
    lint(version, data)
    rendered, issues = resolve_fields(version, fixture)
    result = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(result, "w", zipfile.ZIP_DEFLATED) as out:
        for info in source.infolist():
            content = source.read(info.filename)
            if any(info.filename == name for name, _ in xml_parts({info.filename: content})):
                doc = minidom.parseString(content)
                for paragraph in doc.getElementsByTagNameNS(W, "p"):
                    replace_paragraph_tokens(paragraph, rendered)
                content = doc.toxml(encoding="utf-8")
                if "{{" in content.decode("utf-8"):
                    raise TemplateError("PLACEHOLDER_LEFTOVER")
            out.writestr(info, content)
    return result.getvalue(), {"purpose": "SYNTHETIC_PREVIEW_ONLY", "template_key": version["template_key"],
                               "version": version["version_number"], "template_sha256": sha256(data),
                               "issues": issues, "production_blockers": generation_eligibility(version, issues),
                               "source_context": fixture["source_context"], "resolved_fixture_values": rendered}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["lint", "preview"])
    parser.add_argument("--template", choices=["channel-recruitment", "student-program"])
    args = parser.parse_args()
    versions = read_catalog()["versions"]
    for version in versions:
        if args.template and version["template_key"] != args.template:
            continue
        data = (ROOT / version["template_path"]).read_bytes()
        report = lint(version, data)
        if args.operation == "preview":
            fixture = json.loads((ROOT / version["fixture_path"]).read_text(encoding="utf-8"))
            output, report = preview(version, data, fixture)
            folder = ROOT / "work/v324-phase1/previews"
            folder.mkdir(parents=True, exist_ok=True)
            (folder / (version["template_key"] + "-preview.docx")).write_bytes(output)
            (folder / (version["template_key"] + "-preview.json")).write_text(
                json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            report = {"template_key": version["template_key"], "preview": "CREATED", "issues": report["issues"]}
        print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
