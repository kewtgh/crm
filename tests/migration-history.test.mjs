import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  validateMigrationManifest,
  verifyMigrationDirectory,
} from "../scripts/db-verify-migrations.mjs";

const repositoryPath = (relativePath) => path.resolve(import.meta.dirname, "..", relativePath);

test("canonical verifier emits every discovered migration exactly once with SHA-256", async () => {
  const migrationDirectory = repositoryPath("db/migrations");
  const discovered = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  const output = await verifyMigrationDirectory(migrationDirectory);
  const manifestNames = output.migrations.map(({ name }) => name);

  assert.deepEqual(manifestNames, discovered);
  assert.equal(new Set(manifestNames).size, manifestNames.length);
  assert.equal(output.migrations.length, discovered.length);
  for (const migration of output.migrations) {
    assert.match(migration.checksum, /^[a-f0-9]{64}$/);
  }
});

test("later migrations are discovered dynamically without a latest-filename sentinel", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "lumina-migrations-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "202607150000_self_hosted_foundation.sql"), "select 1;\n");
  await writeFile(path.join(directory, "209912310999_hypothetical_later_migration.sql"), "select 2;\n");

  const output = await verifyMigrationDirectory(directory);
  assert.deepEqual(output.migrations.map(({ name }) => name), [
    "202607150000_self_hosted_foundation.sql",
    "209912310999_hypothetical_later_migration.sql",
  ]);
});

test("manifest validation rejects omissions, invalid checksums, and duplicate names", () => {
  const checksum = "a".repeat(64);
  const discovered = ["001_foundation.sql", "002_feature.sql"];
  assert.throws(
    () => validateMigrationManifest(discovered, [{ name: discovered[0], checksum }]),
    /does not exactly match/,
  );
  assert.throws(
    () => validateMigrationManifest(discovered, discovered.map((name) => ({ name, checksum: "invalid" }))),
    /invalid SHA-256/,
  );
  assert.throws(
    () => validateMigrationManifest(discovered, [
      { name: discovered[0], checksum },
      { name: discovered[0], checksum },
    ]),
    /Duplicate migration names/,
  );
  assert.throws(
    () => validateMigrationManifest([discovered[0], discovered[0]], []),
    /Duplicate discovered migration names/,
  );
});

test("forbidden platform SQL remains rejected by the canonical verifier", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "lumina-forbidden-migration-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "001_forbidden.sql"), "select auth.uid();\n");
  await assert.rejects(() => verifyMigrationDirectory(directory), /contains forbidden platform SQL/);
});
