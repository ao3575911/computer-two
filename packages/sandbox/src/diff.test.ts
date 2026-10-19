import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { boundedSumEdit, proposeFailingAddDiff, unifiedDiff } from "./diff.ts";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(packageRoot, "..", "..");
const addPath = path.join(repoRoot, "fixtures", "failing-add", "add.py");

test("a bounded edit is checked in the sandbox and is not applied", async () => {
  const before = readFileSync(addPath);
  const result = await proposeFailingAddDiff(repoRoot);
  const after = readFileSync(addPath);
  assert.deepEqual(after, before);
  assert.match(after.toString("utf8"), /return left \+ right \+ 1/);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.applied, false);
  assert.equal(result.base.fixture, "fixtures/failing-add");
  assert.deepEqual(
    result.base.files.map((file) => file.path),
    ["fixtures/failing-add/add.py", "fixtures/failing-add/test_add.py"],
  );
  assert.equal(
    result.base.files[0]?.sha256,
    createHash("sha256").update(before).digest("hex"),
  );
  assert.equal(result.base.digest.length, 64);
  assert.match(result.diff, /^--- a\/fixtures\/failing-add\/add\.py$/m);
  assert.match(result.diff, /^\+    return left \+ right$/m);
  assert.match(result.diff, /^-    return left \+ right \+ 1$/m);
  assert.equal(result.diff.includes("test_add.py"), false);
  assert.equal(result.exitCode, 0);
  assert.match(result.rawLog, /\nOK\n/);
  assert.equal(result.rawLog.includes("AssertionError"), false);
  assert.equal(result.rawLog.includes("FAILED"), false);
});

test("the sum edit changes that one expression", () => {
  const source = "def add(left, right):\n    return left + right + 1\n";
  assert.equal(
    boundedSumEdit(source),
    "def add(left, right):\n    return left + right\n",
  );
  assert.equal(boundedSumEdit("return left + right\n"), undefined);
  assert.equal(
    boundedSumEdit("return left + right + 1\nreturn left + right + 1\n"),
    undefined,
  );
  const diff = unifiedDiff(
    "fixtures/failing-add/add.py",
    source,
    "def add(left, right):\n    return left + right\n",
  );
  assert.match(diff, /^-    return left \+ right \+ 1$/m);
  assert.match(diff, /^\+    return left \+ right$/m);
});
