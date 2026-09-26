import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { imageSize, types } from "image-size";

function png(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

test("bounded image metadata compatibility layer preserves required formats", () => {
  assert.deepEqual(types, ["gif", "ico", "jpg", "png", "svg", "webp"]);
  assert.deepEqual(imageSize(png(1200, 630)), { width:1200, height:630, type:"png" });
  assert.deepEqual(
    imageSize(new TextEncoder().encode('<svg viewBox="0 0 800 240"></svg>')),
    { width:800, height:240, type:"svg" },
  );
});

test("vulnerable and unknown image metadata formats fail closed", () => {
  const fixtures = [
    new TextEncoder().encode("icns\0\0\0\0"),
    Uint8Array.from([0xff, 0x0a, 0, 0, 0, 0, 0, 0]),
    new TextEncoder().encode("\0\0\0\u0018ftypheic\0\0\0\0"),
    new Uint8Array(128),
  ];
  for (const fixture of fixtures) {
    assert.throws(() => imageSize(fixture), /Unsupported or invalid image metadata format/);
  }
});

test("dependency policy pins patched advisories without weakening CI", async () => {
  const [manifest, workflow, safePackage, lock] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../vendor/image-size-safe/package.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  assert.equal(manifest.devDependencies["brace-expansion-secure"], "npm:brace-expansion@5.0.9");
  assert.equal(manifest.dependencies.next, "16.3.6");
  assert.equal(manifest.devDependencies["eslint-config-next"], manifest.dependencies.next);
  assert.equal(manifest.overrides["baseline-browser-mapping"], "2.11.0");
  assert.equal(manifest.overrides.browserslist, "4.28.7");
  assert.equal(manifest.overrides["fast-uri"], "3.1.6");
  assert.equal(manifest.overrides["fflate@^0.7.0"], "0.7.5");
  assert.equal(manifest.overrides["image-size"], "file:vendor/image-size-safe");
  assert.equal(manifest.overrides["js-yaml"], "4.3.2");
  assert.equal(manifest.overrides.nanoid, "3.3.18");
  assert.equal(manifest.overrides.sharp, "0.35.4");
  for (const [name, versions] of Object.entries({
    next: ["16.3.6"],
    "baseline-browser-mapping": ["2.11.0"],
    browserslist: ["4.28.7"],
    "fast-uri": ["3.1.6"],
    fflate: ["0.7.5", "0.8.3"],
    "js-yaml": ["4.3.2"],
    nanoid: ["3.3.18"],
    sharp: ["0.35.4"],
  })) {
    const entries = Object.entries(lock.packages).filter(([path]) => path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`));
    assert.ok(entries.length, `${name} must be present in the lockfile`);
    for (const [path, metadata] of entries) assert.ok(versions.includes(metadata.version), `${path} must use a patched version, got ${metadata.version}`);
  }
  assert.equal(safePackage.version, "2.0.3-lumina.1");
  assert.match(workflow, /npm audit --audit-level=moderate/);
});
