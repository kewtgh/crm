"""Bounded tests for offline template foundation; no live domain data."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("templates", ROOT / "scripts/contract-template-tool.py")
t = importlib.util.module_from_spec(spec)
spec.loader.exec_module(t)


class TemplateTests(unittest.TestCase):
    def setUp(self):
        self.versions = t.read_catalog()["versions"]
        self.channel, self.student = copy.deepcopy(self.versions)
        self.fixtures = [json.loads((ROOT / v["fixture_path"]).read_text(encoding="utf-8")) for v in self.versions]

    def blob(self, version):
        return (ROOT / version["template_path"]).read_bytes()

    def patch(self, data, transform):
        out = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(data)) as src, zipfile.ZipFile(out, "w") as dst:
            for item in src.infolist():
                content = src.read(item.filename)
                if item.filename == "word/document.xml":
                    doc = t.minidom.parseString(content)
                    transform(doc)
                    content = doc.toxml(encoding="utf-8")
                dst.writestr(item, content)
        return out.getvalue()

    def test_two_distinct_types_lint_with_exact_bytes(self):
        self.assertEqual({v["contract_type"] for v in self.versions}, t.TYPES)
        for v in self.versions:
            self.assertEqual(t.lint(v, self.blob(v))["status"], "PASS")

    def test_mapping_fields_have_sources_flags_and_different_parties(self):
        a = {f["key"] for f in self.channel["fields"]}
        b = {f["key"] for f in self.student["fields"]}
        self.assertIn("channel.signatory", a)
        self.assertNotIn("channel.signatory", b)
        self.assertTrue({"buyer.signing_name", "participant.name", "guardian.name"} <= b)
        for v in self.versions:
            t.validate_schema(v)
            self.assertTrue(all(not f["allow_override"] for f in v["fields"]))

    def test_duplicate_field_rejected(self):
        self.student["fields"].append(copy.deepcopy(self.student["fields"][0]))
        with self.assertRaisesRegex(t.TemplateError, "DUPLICATE_FIELD"):
            t.validate_schema(self.student)

    def test_reference_guard_detects_residue_without_echoing_value(self):
        for marker in ["TEST-BANK-ACCOUNT", "合成测试主体"]:
            self.student["forbidden_literal_digests"] = [
                {"sha256": t.sha256(marker.encode("utf-8")), "characters": len(marker)}
            ]
            blob = self.patch(self.blob(self.student),
                              lambda d: t.set_text(d.getElementsByTagNameNS(t.W, "t")[0],
                                                   d.getElementsByTagNameNS(t.W, "t")[0].firstChild.data
                                                   + " " + marker))
            self.student["template_sha256"] = t.sha256(blob)
            with self.assertRaises(t.TemplateError) as error:
                t.lint(self.student, blob)
            self.assertEqual(str(error.exception), "PRIVATE_TEMPLATE_RESIDUE_DETECTED")
            self.assertNotIn(marker, str(error.exception))

    def test_reference_guard_schema_fails_closed(self):
        for guards in [None, [], [{"sha256": "invalid", "characters": 8}],
                       [{"sha256": "a" * 64, "characters": False}],
                       [{"sha256": "a" * 64, "characters": 257}]]:
            candidate = copy.deepcopy(self.student)
            candidate["forbidden_literal_digests"] = guards
            with self.assertRaisesRegex(t.TemplateError, "INVALID_REFERENCE_GUARD"):
                t.validate_schema(candidate)
        self.student["forbidden_literals"] = ["SYNTHETIC-REFERENCE"]
        with self.assertRaisesRegex(t.TemplateError, "PLAINTEXT_REFERENCE_GUARD_NOT_ALLOWED"):
            t.validate_schema(self.student)

    def test_reference_residue_in_office_metadata_fails_without_echo(self):
        marker = "INVENTED-METADATA-IDENTITY"
        self.student["forbidden_literal_digests"] = [
            {"sha256": t.sha256(marker.encode()), "characters": len(marker)}]
        out = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(self.blob(self.student))) as src, zipfile.ZipFile(out, "w") as dst:
            for item in src.infolist():
                content = src.read(item.filename)
                if item.filename == "docProps/core.xml":
                    doc = t.minidom.parseString(content)
                    t.set_text(doc.getElementsByTagName("dc:creator")[0], marker)
                    content = doc.toxml(encoding="utf-8")
                dst.writestr(item, content)
        blob = out.getvalue()
        self.student["template_sha256"] = t.sha256(blob)
        with self.assertRaises(t.TemplateError) as error:
            t.lint(self.student, blob)
        self.assertEqual(str(error.exception), "PRIVATE_TEMPLATE_RESIDUE_DETECTED")

    def test_unknown_and_malformed_placeholders_rejected(self):
        for text in ["{{unknown.party}}", "{{bad key}}"]:
            blob = self.patch(self.blob(self.student), lambda d: t.set_text(d.getElementsByTagNameNS(t.W, "t")[0], text))
            self.student["template_sha256"] = t.sha256(blob)
            with self.assertRaisesRegex(t.TemplateError, "UNKNOWN_PLACEHOLDER|MALFORMED_PLACEHOLDER"):
                t.lint(self.student, blob)

    def test_required_mapping_unused_rejected(self):
        field = copy.deepcopy(self.student["fields"][0])
        field["key"] = "required.unused"
        self.student["fields"].append(field)
        with self.assertRaisesRegex(t.TemplateError, "UNUSED_REQUIRED_FIELD"):
            t.lint(self.student, self.blob(self.student))

    def test_checksum_change_rejected(self):
        with self.assertRaisesRegex(t.TemplateError, "CHECKSUM_CHANGED"):
            t.lint(self.student, self.blob(self.student) + b"alteration")

    def test_reference_hash_contract(self):
        self.assertEqual(self.channel["source_sha256"], "3fd472fbc5dbf73b4fb4f96255d9b9fc92698d20a4b7eb8b9652156f18cc957e")
        self.assertEqual(self.student["source_sha256"], "b7750ecd0f91075a45a408063e71f2c39c759f4e18afa87a13d3d5e9c20f4712")

    def test_canonical_money_cannot_be_overridden(self):
        f = self.fixtures[1]
        f["confirmed"]["contract.amount"] = "15980.00"
        with self.assertRaisesRegex(t.TemplateError, "OVERRIDE_NOT_ALLOWED"):
            t.resolve_fields(self.student, f)

    def test_unconfirmed_fields_cannot_impersonate_canonical(self):
        f = self.fixtures[1]
        f["canonical"]["guardian.name"] = "primary contact"
        with self.assertRaisesRegex(t.TemplateError, "PROVENANCE_MISMATCH"):
            t.resolve_fields(self.student, f)

    def test_fixture_amount_wins_over_reference(self):
        values, issues = t.resolve_fields(self.student, self.fixtures[1])
        self.assertEqual(values["contract.amount"], "20,000.00")
        self.assertEqual(values["contract.amount_words"], "人民币贰万元整")
        self.assertFalse(any(i["code"] == "MISSING_REQUIRED_FIELD" for i in issues))

    def test_missing_guardian_does_not_use_household_or_buyer(self):
        f = self.fixtures[1]
        f["confirmed"].pop("guardian.name")
        values, issues = t.resolve_fields(self.student, f)
        self.assertIn({"code": "MISSING_REQUIRED_FIELD", "field": "guardian.name"}, issues)
        self.assertIn("Missing", values["guardian.name"])

    def test_adult_confirmed_no_guardian_is_explicit(self):
        f = self.fixtures[1]
        f["confirmed"]["guardian.required"] = False
        f["confirmed"].pop("guardian.name")
        values, _ = t.resolve_fields(self.student, f)
        self.assertIn("Not applicable", values["guardian.name"])

    def test_missing_signatory_does_not_fall_back_to_contact(self):
        f = self.fixtures[0]
        f["confirmed"].pop("channel.signatory")
        _, issues = t.resolve_fields(self.channel, f)
        self.assertIn({"code": "MISSING_REQUIRED_FIELD", "field": "channel.signatory"}, issues)

    def test_missing_money_is_explicit_not_blank(self):
        f = self.fixtures[1]
        f["canonical"].pop("contract.amount")
        values, issues = t.resolve_fields(self.student, f)
        self.assertIn("Missing", values["contract.amount"])
        self.assertIn({"code": "MISSING_REQUIRED_FIELD", "field": "contract.amount_words"}, issues)

    def test_currency_decimal_and_cny_words(self):
        expected = {"0": "人民币零元整", "10": "人民币壹拾元整", "10001.05": "人民币壹万零壹元零伍分", "100000001": "人民币壹亿零壹元整", "15980": "人民币壹万伍仟玖佰捌拾元整"}
        for value, words in expected.items():
            self.assertEqual(t.amount_words(value, "CNY"), words)
        self.assertEqual(t.amount_words("20000", "USD"), "USD 20,000.00")
        for value in [20000, "1.001", "-1", "NaN", "20,000"]:
            with self.assertRaises(t.TemplateError):
                t.decimal_amount(value)

    def test_actual_date_not_fixed_reference_date(self):
        self.assertEqual(t.date_text("2027-03-16"), "2027年03月16日")
        for invalid in ["2027-02-29", "2027/01/01", "2027-1-1"]:
            with self.assertRaises(t.TemplateError):
                t.date_text(invalid)
        f = self.fixtures[1]
        f["canonical"]["program.end_on"] = "2027-01-01"
        with self.assertRaisesRegex(t.TemplateError, "DATE_ORDER"):
            t.resolve_fields(self.student, f)

    def test_fee_components_are_document_confirmations_not_costs(self):
        f = self.fixtures[1]
        f["confirmed"]["service.program_component"] = "12980"
        with self.assertRaisesRegex(t.TemplateError, "FEE_COMPONENTS"):
            t.resolve_fields(self.student, f)

    def test_unsupported_commission_not_green_and_never_creates_rule(self):
        _, issues = t.resolve_fields(self.channel, self.fixtures[0])
        self.assertEqual(sum(i["code"] == "UNSUPPORTED_BY_CURRENT_COMMISSION_ENGINE" for i in issues), 2)
        self.assertIn("UNSUPPORTED_BY_CURRENT_COMMISSION_ENGINE", t.generation_eligibility(self.channel, issues))

    def test_percent_rule_is_not_presented_as_fixed_3000(self):
        f = self.fixtures[0]
        f["source_context"]["commission_basis"] = "PERCENT_OF_NET_COLLECTED"
        _, issues = t.resolve_fields(self.channel, f)
        self.assertIn({"code": "UNSUPPORTED_COMMISSION_BASIS", "field": "commission.amount"}, issues)

    def test_only_approved_reviewed_version_has_eligibility(self):
        self.assertIn("TEMPLATE_NOT_APPROVED", t.generation_eligibility(self.student, []))
        v = copy.deepcopy(self.student)
        v.update(status="APPROVED", approved_by="SYNTHETIC_APPROVER", approved_at="2027-01-01", approval_reference="SYNTHETIC_APPROVAL", review_items=[])
        self.assertEqual(t.generation_eligibility(v, []), [])
        v["status"] = "RETIRED"
        self.assertIn("TEMPLATE_NOT_APPROVED", t.generation_eligibility(v, []))

    def test_used_approved_version_requires_new_draft(self):
        v = copy.deepcopy(self.student)
        v.update(status="APPROVED", used_document_count=1)
        changed = copy.deepcopy(v)
        changed["fields"][0]["value"] = "changed"
        with self.assertRaisesRegex(t.TemplateError, "IMMUTABLE"):
            t.assert_version_change(v, changed)
        changed.update(version_number=2, status="DRAFT")
        t.assert_version_change(v, changed)
        retired = copy.deepcopy(v)
        retired["status"] = "RETIRED"
        t.assert_version_change(v, retired)
        with self.assertRaises(t.TemplateError):
            t.assert_version_change(retired, v)

    def test_cross_run_replacement_real_docx(self):
        def split(doc):
            for p in doc.getElementsByTagNameNS(t.W, "p"):
                for node in list(p.getElementsByTagNameNS(t.W, "t")):
                    text = node.firstChild.data if node.firstChild else ""
                    if "{{contract.amount}}" in text:
                        before, after = text.split("{{contract.amount}}", 1)
                        t.set_text(node, before + "{{contract.")
                        run = doc.createElementNS(t.W, "w:r")
                        tail = doc.createElementNS(t.W, "w:t")
                        run.appendChild(tail)
                        t.set_text(tail, "amount}}" + after)
                        p.appendChild(run)
                        return
        blob = self.patch(self.blob(self.student), split)
        self.student["template_sha256"] = t.sha256(blob)
        out, _ = t.preview(self.student, blob, self.fixtures[1])
        body = t.minidom.parseString(t.document_parts(out)["word/document.xml"])
        text = "\n".join(t.paragraph_text(p) for p in body.getElementsByTagNameNS(t.W, "p"))
        self.assertIn("20,000.00", text)
        self.assertNotIn("{{", text)

    def test_table_header_footer_replacement_and_xml_integrity(self):
        for v, f in zip(self.versions, self.fixtures):
            out, report = t.preview(v, self.blob(v), f)
            for name, content in t.document_parts(out).items():
                if name.endswith((".xml", ".rels")):
                    t.minidom.parseString(content)
            for name, content in t.xml_parts(t.document_parts(out)):
                self.assertNotIn(b"{{", content, name)
            self.assertEqual(report["purpose"], "SYNTHETIC_PREVIEW_ONLY")

    def test_preview_is_synthetic_only_and_preserves_inputs(self):
        v, f = self.student, self.fixtures[1]
        before = copy.deepcopy((v, f))
        t.preview(v, self.blob(v), f)
        self.assertEqual((v, f), before)
        f["synthetic"] = False
        with self.assertRaisesRegex(t.TemplateError, "SYNTHETIC_FIXTURE"):
            t.preview(v, self.blob(v), f)


if __name__ == "__main__":
    unittest.main(verbosity=2)
