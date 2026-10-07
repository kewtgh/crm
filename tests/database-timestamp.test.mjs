import assert from "node:assert/strict";
import test from "node:test";
import { databaseTimestamp, preciseTimestampTypes } from "../lib/db/timestamp.ts";

test("optimistic tokens retain all PostgreSQL microseconds and timezone", () => {
  assert.equal(databaseTimestamp("2026-10-07 12:34:56.123456+00"), "2026-10-07T12:34:56.123456+00:00");
  assert.equal(databaseTimestamp("2026-10-07 12:34:56.000001+08"), "2026-10-07T12:34:56.000001+08:00");
  assert.equal(databaseTimestamp("2026-10-07 12:34:56.123456+05:30"), "2026-10-07T12:34:56.123456+05:30");
  const parse = preciseTimestampTypes.getTypeParser(1184);
  assert.notEqual(parse("2026-10-07 12:34:56.123456+00"), parse("2026-10-07 12:34:56.123457+00"));
});

test("numeric parsing keeps its existing precision contract", () => {
  assert.equal(preciseTimestampTypes.getTypeParser(1700)("12345678901234567890.12"), "12345678901234567890.12");
});
