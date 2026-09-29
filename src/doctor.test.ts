import assert from "node:assert/strict";
import { test } from "node:test";
import { checkNodeVersion } from "./doctor";

test("checkNodeVersion passes for a supported version", () => {
  const result = checkNodeVersion("20.11.0");
  assert.equal(result.status, "ok");
  assert.match(result.message, /^v20\.11\.0/);
});

test("checkNodeVersion passes at exactly the minimum supported major", () => {
  const result = checkNodeVersion("18.0.0");
  assert.equal(result.status, "ok");
});

test("checkNodeVersion fails below the minimum supported major", () => {
  const result = checkNodeVersion("16.20.0");
  assert.equal(result.status, "fail");
  assert.match(result.message, /requires Node\.js 18\+/);
});
