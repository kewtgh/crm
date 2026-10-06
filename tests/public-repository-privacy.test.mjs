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

test("pinned Chromium resolves from operator environment without a committed home path", () => {
  assert.equal(chromium1243Path({ PLAYWRIGHT_CHROMIUM_1243_PATH: "selected-browser" }), "selected-browser");
  assert.equal(chromium1243Path({ LOCALAPPDATA: "test-local-data" }),
    path.join("test-local-data", "ms-playwright", "chromium-1243", "chrome-win64", "chrome.exe"));
  assert.equal(chromium1243Path({ USERPROFILE: "synthetic-home" }),
    path.join("synthetic-home", "AppData", "Local", "ms-playwright", "chromium-1243", "chrome-win64", "chrome.exe"));
});

test("contract reference guards contain digests and neutral source aliases", () => {
  const catalog = JSON.parse(readFileSync(path.join(root, "templates/contracts/catalog.json"), "utf8"));
  assert.deepEqual(catalog.versions.map(version => version.source_filename),
    ["channel-recruitment-reference.docx", "student-program-reference.docx"]);
  for (const version of catalog.versions) {
    assert.equal(version.status, "DRAFT");
    assert.equal(Object.hasOwn(version, "forbidden_literals"), false);
    assert.ok(version.forbidden_literal_digests.length > 0);
    for (const guard of version.forbidden_literal_digests) assert.match(guard.sha256, /^[a-f0-9]{64}$/);
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
    assert.doesNotMatch(text, /[A-Z]:[\\/]+Users[\\/]+[^\\/\s<>]+[\\/]/i, relative);
    assert.doesNotMatch(text, /[A-Z]:[\\/]+[^\\/\s<>]+[\\/]+(?:Downloads|Documents)[\\/]/i, relative);
  }
});

test("operational files are ignored while migration and public example contracts remain eligible", () => {
  const files = ["private.env", "logs/run.log", "backup.dump", "exports/customers.csv",
    "private-documents/source.docx", "private-contracts/reference.pdf", "work/privacy-audit/evidence.json",
    ".env.example", "deploy/deploy.env.example", "db/migrations/999_example.sql"];
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "--stdin"],
    { cwd: root, encoding: "utf8", input: files.join("\n") }).trim().split(/\r?\n/);
  assert.deepEqual(ignored, files.slice(0, 7));
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
  const { guards } = JSON.parse(readFileSync(path.join(root, "tests/fixtures/public-privacy-fingerprints.json"), "utf8"));
  assert.ok(guards.length >= 4);
  for (const relative of currentFiles()) {
    const data = readFileSync(path.join(root, relative));
    const parts = data[0] === 0x50 && data[1] === 0x4b
      ? Object.entries(unzipSync(data)).filter(([name]) => /\.(xml|rels|txt|json)$/.test(name)).map(([, bytes]) => Buffer.from(bytes).toString("utf8"))
      : [data.toString("utf8")];
    for (const text of parts) {
      for (const guard of guards) {
        assert.match(guard.sha256, /^[a-f0-9]{64}$/);
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
    const fixture = JSON.parse(readFileSync(path.join(root, "templates/contracts", name), "utf8"));
    assert.equal(fixture.synthetic, true);
    assert.ok(Object.entries(fixture.source_context).filter(([key]) => key.endsWith("_id"))
      .every(([, value]) => value.startsWith("SYNTHETIC_")));
    for (const value of Object.values(fixture.confirmed)) {
      if (typeof value === "string" && value.includes("@")) assert.match(value, /@example\.test$/);
    }
    assert.match(fixture.confirmed["bank.account"], /^(TEST-|SYNTHETIC_)/);
    assert.equal(fixture.confirmed["company.phone"], "SYNTHETIC_PHONE");
  }
  const seed = readFileSync(path.join(root, "archive/supabase/seed.sql"), "utf8");
  assert.match(seed, /Independently fictional/);
  for (const email of seed.match(/[\w.+-]+@[\w.-]+\.[a-z]+/g) ?? []) assert.match(email, /@example\.test$/);
});

test("DOCX metadata and source relationships contain only neutral template identities", () => {
  for (const name of ["channel-recruitment-agreement-v1.docx", "student-program-agreement-v1.docx"]) {
    const parts = unzipSync(readFileSync(path.join(root, "templates/contracts", name)));
    const core = Buffer.from(parts["docProps/core.xml"]).toString("utf8");
    for (const tag of ["dc:creator", "cp:lastModifiedBy"]) {
      assert.match(core, new RegExp(`<${tag}(?:\\s[^>]*)?>Lumina DRAFT template</${tag}>`));
    }
    const app = Buffer.from(parts["docProps/app.xml"]).toString("utf8");
    assert.doesNotMatch(app, /<Company>[^<]+<\/Company>/);
    for (const [part, data] of Object.entries(parts)) if (/\.(xml|rels)$/.test(part)) {
      const text = Buffer.from(data).toString("utf8");
      assert.doesNotMatch(text, /TargetMode=["']External["']/);
      assert.doesNotMatch(text, /<w:(?:ins|del)\b/);
      assert.doesNotMatch(text, /[A-Z]:[\\/]+Users[\\/]/i);
    }
  }
});

test("all workflow uploads use the fixed public summary allowlist and never dump environments", () => {
  const workflows = currentFiles().filter(name => name.startsWith(".github/workflows/"));
  let uploads = 0;
  for (const name of workflows) {
    const text = readFileSync(path.join(root, name), "utf8");
    assert.doesNotMatch(text, /\bprintenv\b|\bset\s+-x\b|echo\s+["']?\$\{?\{?\s*secrets\./);
    for (const block of text.split(/\n\s+- name:/).filter(block => block.includes("actions/upload-artifact@"))) {
      uploads++;
      assert.match(block, /path: work\/public-artifacts\/browser-qa-summary\.json\s/);
      assert.doesNotMatch(block, /path:.*\*|path: work\/browser-qa/);
      assert.match(block, /steps\.public_summary\.outcome == 'success'/);
    }
  }
  assert.equal(uploads, 1);
  const release = readFileSync(path.join(root, ".github/workflows/full-release-gate.yml"), "utf8");
  assert.match(release, /publish-public-ci-artifacts\.mjs/);
  assert.match(release, /ci:private-stage -- release/);
  assert.match(release, /::add-mask::/);
  const privacy = readFileSync(path.join(root, ".github/workflows/public-privacy.yml"), "utf8");
  assert.doesNotMatch(privacy, /paths-ignore:/);
  assert.match(privacy, /pull_request:/);
  assert.match(privacy, /npm run test:public-privacy/);
});
