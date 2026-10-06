import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { unzipSync } from "fflate";
import test from "node:test";

const require = createRequire(import.meta.url);
const { chromium1243Path } = require("../scripts/lib/chromium-runtime-path.cjs");
const root = path.resolve(import.meta.dirname, "..");
const currentFiles = () => execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const digest = value => createHash("sha256").update(value).digest("hex");
function readPublicJson(relative) {
  try { return JSON.parse(readFileSync(path.join(root, relative), "utf8")); }
  catch { throw new Error(`PUBLIC_JSON_SCHEMA_INVALID:${relative}`); }
}

test("pinned Chromium resolves from operator environment without a committed home path", () => {
  assert.equal(chromium1243Path({ PLAYWRIGHT_CHROMIUM_1243_PATH: "selected-browser" }), "selected-browser");
  assert.equal(chromium1243Path({ LOCALAPPDATA: "test-local-data" }),
    path.join("test-local-data", "ms-playwright", "chromium-1243", "chrome-win64", "chrome.exe"));
  assert.equal(chromium1243Path({ USERPROFILE: "synthetic-home" }),
    path.join("synthetic-home", "AppData", "Local", "ms-playwright", "chromium-1243", "chrome-win64", "chrome.exe"));
});

test("contract reference guards contain digests and neutral source aliases", () => {
  const catalog = readPublicJson("templates/contracts/catalog.json");
  assert.ok(JSON.stringify(catalog.versions.map(version => version.source_filename)) ===
    JSON.stringify(["channel-recruitment-reference.docx", "student-program-reference.docx"]),
  "PRIVATE_SOURCE_ALIAS_DETECTED");
  for (const version of catalog.versions) {
    assert.ok(version.status === "DRAFT", "TEMPLATE_STATUS_MUST_REMAIN_DRAFT");
    assert.equal(Object.hasOwn(version, "forbidden_literals"), false);
    assert.ok(version.forbidden_literal_digests.length > 0);
    for (const guard of version.forbidden_literal_digests) assert.ok(/^[a-f0-9]{64}$/.test(guard.sha256), "PUBLIC_DIGEST_SCHEMA_INVALID");
  }
});

test("tracked documentation and pending Revenue decisions do not publish personal home paths", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0");
  const candidates = ["docs/REVENUE_FOUNDATION_ARCHITECTURE.md", "docs/V326_PHASE0_VERIFICATION.md",
    "docs/V326_REVENUE_POLICY_DECISION_PACK.md", "docs/revenue-foundation-contract.json"];
  for (const relative of new Set([...tracked.filter(file => file.endsWith(".md")), ...candidates])) {
    let text;
    try { text = readFileSync(path.join(root, relative), "utf8"); }
    catch (error) { if (error.code === "ENOENT" && candidates.includes(relative)) continue; throw error; }
    assert.ok(!/[A-Z]:[\\/]+Users[\\/]+[^\\/\s<>]+[\\/]/i.test(text), `PRIVATE_WORKSTATION_PATH:${relative}`);
    assert.ok(!/[A-Z]:[\\/]+[^\\/\s<>]+[\\/]+(?:Downloads|Documents)[\\/]/i.test(text), `PRIVATE_WORKSTATION_PATH:${relative}`);
  }
});

test("operational files are ignored while migration and public example contracts remain eligible", () => {
  const files = ["private.env", "logs/run.log", "backup.dump", "exports/customers.csv",
    "private-documents/source.docx", "private-contracts/reference.pdf", "work/privacy-audit/evidence.json",
    ".env.example", "deploy/deploy.env.example", "db/migrations/999_example.sql"];
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"],
    { cwd: root, encoding: "utf8", input: files.join("\n") }).trim().split(/\r?\n/);
  assert.deepEqual(ignored, files.slice(0, 7));
  // Fresh hosted checkouts have no ignored work/ directory yet.
  mkdirSync(path.join(root, "work"), { recursive: true });
  const temporary = mkdtempSync(path.join(root, "work/privacy-ignore-fixture-"));
  try {
    const privateFiles = ["fake.env", "fake.log", "fake.dump", "private-evidence/result.json"];
    for (const name of privateFiles) {
      const filename = path.join(temporary, name);
      mkdirSync(path.dirname(filename), { recursive: true });
      writeFileSync(filename, "INDEPENDENTLY-FICTIONAL-IGNORE-FIXTURE");
    }
    const paths = privateFiles.map(name => path.relative(root, path.join(temporary, name)).replaceAll("\\", "/"));
    assert.equal(execFileSync("git", ["check-ignore", "--stdin"], { cwd: root,
      input: paths.join("\n"), encoding: "utf8" }).trim().split(/\r?\n/).length, paths.length);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("known private identities, bank and source filenames are absent from every tracked/candidate file", () => {
  const { guards } = readPublicJson("tests/fixtures/public-privacy-fingerprints.json");
  assert.ok(guards.length >= 4);
  for (const relative of currentFiles()) {
    const data = readFileSync(path.join(root, relative));
    const parts = data[0] === 0x50 && data[1] === 0x4b
      ? Object.entries(unzipSync(data)).filter(([name]) => /\.(xml|rels|txt|json)$/.test(name)).map(([, bytes]) => Buffer.from(bytes).toString("utf8"))
      : [data.toString("utf8")];
    for (const text of parts) {
      for (const guard of guards) {
        assert.ok(/^[a-f0-9]{64}$/.test(guard.sha256), "PUBLIC_DIGEST_SCHEMA_INVALID");
        const chunks = guard.category === "PRIVATE_SOURCE_FILENAME" ? text.split(/\r?\n/).filter(line => line.includes(".docx"))
          : guard.category === "BANK_OR_CONTACT_DETAILS" ? text.match(/[\d+\-\s]{12,}/g) ?? [] : text.match(/[\u4e00-\u9fff]+/g) ?? [];
        for (const chunk of chunks) for (let i = 0; i + guard.characters <= chunk.length; i++) {
          if (digest(chunk.slice(i, i + guard.characters)) === guard.sha256) {
            assert.fail(`PRIVATE_CONTENT_DETECTED:${relative}:${guard.category}`);
          }
        }
        if (guard.normalized_sha256) for (const chunk of chunks) {
          const normalized = chunk.replace(/[^0-9]/g, "");
          for (let i = 0; i + guard.normalized_characters <= normalized.length; i++) {
            if (digest(normalized.slice(i, i + guard.normalized_characters)) === guard.normalized_sha256) {
              assert.fail(`PRIVATE_CONTENT_DETECTED:${relative}:${guard.category}`);
            }
          }
        }
      }
    }
  }
});

test("contract previews and archived acceptance identities are independently fictional", () => {
  for (const name of ["channel-recruitment-fixture.json", "student-program-fixture.json"]) {
    const fixture = readPublicJson(`templates/contracts/${name}`);
    assert.equal(fixture.synthetic, true);
    assert.ok(Object.entries(fixture.source_context).filter(([key]) => key.endsWith("_id"))
      .every(([, value]) => value.startsWith("SYNTHETIC_")));
    for (const value of Object.values(fixture.confirmed)) {
      if (typeof value === "string" && value.includes("@")) assert.ok(/@example\.test$/.test(value), "NON_SYNTHETIC_FIXTURE_EMAIL");
    }
    assert.ok(/^(TEST-|SYNTHETIC_)/.test(fixture.confirmed["bank.account"]), "NON_SYNTHETIC_BANK_FIXTURE");
    assert.ok(fixture.confirmed["company.phone"] === "SYNTHETIC_PHONE", "NON_SYNTHETIC_PHONE_FIXTURE");
  }
  const seed = readFileSync(path.join(root, "archive/supabase/seed.sql"), "utf8");
  assert.ok(/Independently fictional/.test(seed), "SEED_PROVENANCE_REQUIRED");
  for (const email of seed.match(/[\w.+-]+@[\w.-]+\.[a-z]+/g) ?? []) assert.ok(/@example\.test$/.test(email), "NON_SYNTHETIC_SEED_EMAIL");
});

test("DOCX metadata and source relationships contain only neutral template identities", () => {
  for (const name of ["channel-recruitment-agreement-v1.docx", "student-program-agreement-v1.docx"]) {
    const parts = unzipSync(readFileSync(path.join(root, "templates/contracts", name)));
    const core = Buffer.from(parts["docProps/core.xml"]).toString("utf8");
    for (const tag of ["dc:creator", "cp:lastModifiedBy"]) {
      assert.ok(new RegExp(`<${tag}(?:\\s[^>]*)?>Lumina DRAFT template</${tag}>`).test(core), `PRIVATE_DOCX_METADATA:${name}:${tag}`);
    }
    const app = Buffer.from(parts["docProps/app.xml"]).toString("utf8");
    assert.ok(!/<Company>[^<]+<\/Company>/.test(app), `PRIVATE_DOCX_COMPANY:${name}`);
    for (const [part, data] of Object.entries(parts)) if (/\.(xml|rels)$/.test(part)) {
      const text = Buffer.from(data).toString("utf8");
      assert.ok(!/TargetMode=["']External["']/.test(text), `DOCX_EXTERNAL_RELATIONSHIP:${name}`);
      assert.ok(!/<w:(?:ins|del)\b/.test(text), `DOCX_TRACKED_CHANGE:${name}`);
      assert.ok(!/[A-Z]:[\\/]+Users[\\/]/i.test(text), `PRIVATE_DOCX_PATH:${name}`);
    }
  }
});

test("all workflow uploads use the fixed public summary allowlist and never dump environments", () => {
  const workflows = currentFiles().filter(name => name.startsWith(".github/workflows/"));
  let uploads = 0;
  for (const name of workflows) {
    const text = readFileSync(path.join(root, name), "utf8");
    assert.ok(!/\bprintenv\b|\bset\s+-x\b|echo\s+["']?\$\{?\{?\s*secrets\./.test(text), `WORKFLOW_PRIVATE_LOGGING:${name}`);
    for (const block of text.split(/\n\s+- name:/).filter(block => block.includes("actions/upload-artifact@"))) {
      uploads++;
      assert.ok(/path: work\/public-artifacts\/browser-qa-summary\.json\s/.test(block), `WORKFLOW_ARTIFACT_ALLOWLIST:${name}`);
      assert.ok(!/path:.*\*|path: work\/browser-qa/.test(block), `WORKFLOW_RAW_ARTIFACT:${name}`);
      assert.ok(/steps\.public_summary\.outcome == 'success'/.test(block), `WORKFLOW_PUBLICATION_FAILURE_GATE:${name}`);
    }
  }
  assert.equal(uploads, 1);
  const release = readFileSync(path.join(root, ".github/workflows/full-release-gate.yml"), "utf8");
  assert.ok(/publish-public-ci-artifacts\.mjs/.test(release), "PUBLIC_SUMMARY_STEP_REQUIRED");
  assert.ok(/ci:private-stage -- release/.test(release), "PRIVATE_RELEASE_CAPTURE_REQUIRED");
  assert.ok(/::add-mask::/.test(release), "RUNNER_PATH_MASK_REQUIRED");
  const privacy = readFileSync(path.join(root, ".github/workflows/public-privacy.yml"), "utf8");
  assert.ok(!/paths-ignore:/.test(privacy), "DOCUMENTATION_PRIVACY_GATE_REQUIRED");
  assert.ok(/pull_request:/.test(privacy), "PR_PRIVACY_GATE_REQUIRED");
  assert.ok(/npm run test:public-privacy/.test(privacy), "PRIVACY_CONTRACT_STEP_REQUIRED");
});
