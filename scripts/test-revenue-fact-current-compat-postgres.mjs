import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Explicitly authorized compatibility adapter. The historical suite is never edited.
// Only its phase-local absence assertion changes; every financial assertion is retained.
const historicalPath = "scripts/test-revenue-fact-postgres.mjs";
const original = readFileSync(historicalPath, "utf8");
const hash = value => createHash("sha256").update(value).digest("hex");
const obsolete = `  assert.equal((await one("select to_regclass('public.cash_applications') x")).x,null);`;
assert.equal(original.split(obsolete).length, 2, "expected exactly one known stage-boundary assertion");
const ownership = `  assert.equal((await one("select to_regclass('public.cash_applications') x")).x,"cash_applications");
  assert.doesNotMatch(readCompatibilityFile("db/migrations/202610080118_revenue_facts.sql","utf8"),/create table public\\.cash_applications/);
  assert.match(readCompatibilityFile("db/migrations/202610080119_cash_applications.sql","utf8"),/create table public\\.cash_applications/);`;
const effective = 'import { readFileSync as readCompatibilityFile } from "node:fs";\n' + original
  .replace(obsolete, ownership)
  .replace("REVENUE_R5D_POSTGRES_PASS", "REVENUE_R5D_CURRENT_COMPAT_POSTGRES_PASS")
  .replace("and no cash-application owner", "and R5E cash-owner migration boundary");
const directory = "work/revenue-r5e/compatibility";
mkdirSync(directory, { recursive: true });
const script = `${directory}/r5d-current.mjs`;
writeFileSync(script, effective);
writeFileSync(`${directory}/manifest.json`, JSON.stringify({ historicalPath,
  originalSha256: hash(original), effectiveSha256: hash(effective),
  assertionChange: "cash owner absent -> introduced by 119, not 118", financialAssertionsChanged: false }, null, 2));
console.log("R5D current-schema compatibility mode; unchanged historical result is reported separately.");
const result = spawnSync(process.execPath, [script], { stdio: "inherit", windowsHide: true });
assert.equal(hash(readFileSync(historicalPath, "utf8")), hash(original), "historical test bytes remain unchanged");
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
