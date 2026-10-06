import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import uri from "fast-uri";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const braces = require("braces");

test("bounded braces retains compiled globs, nested expansion, ranges and escaping", () => {
  assert.deepEqual(braces("src/{app,lib}/*.{ts,tsx}"), ["src/(app|lib)/*.(ts|tsx)"]);
  assert.deepEqual(braces.expand("a{b,c,/{x,y}}/e"), ["ab/e", "ac/e", "a/x/e", "a/y/e"]);
  assert.deepEqual(braces.expand("{01..03}"), ["01", "02", "03"]);
  assert.deepEqual(braces.expand("{2..6..2}"), ["2", "4", "6"]);
  assert.deepEqual(braces.expand("a\\{b,c}d"), ["a{b,c}d"]);
  assert.deepEqual(braces(["{a,b}", "{b,c}"], { expand: true, nodupes: true }), ["a", "b", "c"]);
  assert.throws(() => braces.expand("{1..10001}"), /range limit/);
});

test("CVE-2026-93687 deeply nested and malformed patterns fail before stack exhaustion", () => {
  for (const pattern of ["{".repeat(3000) + "a,b" + "}".repeat(3000), "(".repeat(3000) + "x" + ")".repeat(3000), "{".repeat(3000), "({".repeat(1000) + "x" + "})".repeat(1000)]) {
    for (const operation of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => operation(pattern, { maxDepth: Infinity, maxLength: Infinity }), error => error instanceof SyntaxError && /maximum depth/.test(error.message));
    }
  }
  const shallow = "{".repeat(128) + "a" + "}".repeat(128);
  assert.equal(braces.stringify(shallow), shallow);
  assert.equal(braces.compile(shallow), shallow);
  assert.deepEqual(braces.expand(shallow), [shallow]);
  assert.equal(braces.stringify("'" + "{".repeat(3000) + "'"), "{".repeat(3000));
});

test("direct AST input and cyclic child nodes cannot bypass bounded walkers", () => {
  for (const operation of [braces.compile, braces.expand, braces.stringify]) {
    const ast = { type: "root", nodes: [] };
    let current = ast;
    for (let depth = 0; depth < 1000; depth++) { const next = { type: "root", nodes: [], parent: current }; current.nodes.push(next); current = next; }
    assert.throws(() => operation(ast), error => error instanceof SyntaxError && /maximum depth/.test(error.message));
    const cycle = { type: "root", nodes: [] }; cycle.nodes.push(cycle);
    assert.throws(() => operation(cycle), error => error instanceof SyntaxError && /maximum depth/.test(error.message));
  }
});

test("every micromatch consumer resolves the patched local braces implementation", () => {
  const micromatchRequire = createRequire(require.resolve("micromatch/package.json"));
  assert.equal(micromatchRequire("braces"), braces);
  assert.deepEqual(require("micromatch")(["src/a.ts", "src/b.tsx", "src/c.js"], "src/*.{ts,tsx}"), ["src/a.ts", "src/b.tsx"]);
});

test("patched brace expansion preserves the legacy CommonJS minimatch API", () => {
  const expand = require("../vendor/brace-expansion-compat/index.cjs");
  assert.equal(typeof expand, "function");
  assert.deepEqual(expand("src/{app,lib}/*.{ts,tsx}"), ["src/app/*.ts", "src/app/*.tsx", "src/lib/*.ts", "src/lib/*.tsx"]);
  assert.deepEqual(expand("item{1..3}"), ["item1", "item2", "item3"]);
});

test("patched URI serialization rejects authority injection and malformed hosts", () => {
  for (const port of ["@127.0.0.1:8124", "443/attacker", "abc"]) {
    assert.throws(() => uri.serialize({scheme:"https",host:"trusted.example",port,path:"/app"}), /port is malformed/);
  }
  assert.equal(uri.serialize({scheme:"https",host:"trusted.example",port:"443",path:"/app"}), "https://trusted.example:443/app");
  assert.match(uri.parse("https://[trusted.example/path").error, /host is malformed/);
});

test("dependency policy pins patched advisories without weakening CI", async () => {
  const [manifest, workflow, safePackage, lock] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../vendor/braces-safe/package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(manifest.devDependencies["brace-expansion-secure"], "npm:brace-expansion@5.0.12");
  assert.equal(manifest.dependencies.next, "16.3.8");
  assert.equal(manifest.devDependencies["eslint-config-next"], manifest.dependencies.next);
  assert.equal(manifest.overrides["baseline-browser-mapping"], "2.11.27");
  assert.equal(manifest.overrides.browserslist, "4.29.3");
  assert.equal(manifest.overrides["fast-uri"], "4.2.1");
  assert.equal(manifest.overrides.fflate, "0.8.3");
  assert.equal(manifest.overrides["image-size"], undefined);
  assert.ok(!Object.keys(lock.packages).some(path => path.endsWith("node_modules/image-size")), "vinext no longer installs image-size");
  assert.equal(manifest.overrides.braces, "file:vendor/braces-safe");
  assert.equal(manifest.overrides["js-yaml"], "5.4.2");
  assert.equal(manifest.overrides.nanoid, "6.0.1");
  assert.equal(manifest.overrides.sharp, "0.35.5");
  assert.equal(lock.packages["node_modules/brace-expansion-secure"].version, "5.0.12");
  for (const [name, versions] of Object.entries({
    next: ["16.3.8"],
    "baseline-browser-mapping": ["2.11.27"],
    browserslist: ["4.29.3"],
    "fast-uri": ["4.2.1"],
    fflate: ["0.8.3"],
    "js-yaml": ["5.4.2"],
    nanoid: ["6.0.1"],
    sharp: ["0.35.5"],
  })) {
    const entries = Object.entries(lock.packages).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
    if (["next", "browserslist", "fflate", "sharp"].includes(name)) assert.ok(entries.length, `${name} must be present in the lockfile`);
    for (const [path, metadata] of entries) assert.ok(versions.includes(metadata.version), `${path} must use a patched version, got ${metadata.version}`);
  }
  assert.equal(safePackage.version, "3.0.4-lumina.1");
  const braceEntries = Object.entries(lock.packages).filter(([path]) => path.endsWith("node_modules/braces"));
  assert.ok(braceEntries.length);
  for (const [path, metadata] of braceEntries) {
    assert.equal(metadata.version, safePackage.version, `${path} must install the bounded local fork`);
    assert.equal(metadata.resolved, "file:vendor/braces-safe");
    assert.ok(!metadata.link, "file dependencies must be packed with their child dependencies");
  }
  assert.match(workflow, /npm audit --audit-level=moderate/);
});

test("independent CI audit projects pin patched sharp including native binaries", async () => {
  const workerRoot = new URL("../infrastructure/email-delivery-worker/", import.meta.url);
  const [manifest, lock, workflow] = await Promise.all([
    readFile(new URL("package.json", workerRoot), "utf8").then(JSON.parse),
    readFile(new URL("package-lock.json", workerRoot), "utf8").then(JSON.parse),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ]);
  assert.equal(manifest.overrides.sharp, "0.35.5");
  assert.deepEqual(lock.packages[""].devDependencies, manifest.devDependencies);
  const sharpEntries = Object.entries(lock.packages).filter(([key]) => key.endsWith("node_modules/sharp"));
  assert.ok(sharpEntries.length, "worker audit has its own transitive sharp dependency");
  for (const [key, entry] of sharpEntries) {
    assert.equal(entry.version, manifest.overrides.sharp, `${key} must not retain vulnerable sharp`);
    for (const [name, version] of Object.entries(entry.optionalDependencies)) {
      const native = lock.packages[`node_modules/${name}`];
      assert.ok(native, `${name} must have a reproducible native dependency entry`);
      assert.equal(native.version, version, `${name} must match patched sharp's native dependency`);
    }
  }
  for (const prefix of ["infrastructure/email-delivery-worker", "planning-source/education-intelligent-crm-planning-v1"]) {
    assert.ok(workflow.includes(`npm --prefix ${prefix} audit --audit-level=moderate`));
  }
});
