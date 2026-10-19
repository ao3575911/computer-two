import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyReviewedPatch, beginLocalDispatch, createDispatchGate } from "./apply.ts";
import { boundedSumEdit, captureBaseRevision } from "./diff.ts";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(packageRoot, "..", "..");
const fixture = path.join(repoRoot, "fixtures", "failing-add");

test("stop blocks a new local dispatch before it starts", async () => {
  const gate = createDispatchGate();
  gate.stop();
  let started = 0;
  const admission = beginLocalDispatch(gate);
  if (admission.ok) {
    started += 1;
  }
  assert.equal(started, 0);
  assert.equal(admission.ok, false);
  if (!admission.ok) {
    assert.equal(admission.status, "cancelled");
  }

  const outcome = await applyReviewedPatch(
    "/tmp/computer-two-dispatch-blocked",
    { baseDigest: "a".repeat(64), resultSha256: "b".repeat(64) },
    gate,
  );
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.status, "cancelled");
  }
});

test("apply writes the reviewed sum when the base is unchanged", async () => {
  const root = copyFixture();
  try {
    const review = reviewOf(root);
    const outcome = await applyReviewedPatch(root, review, createDispatchGate());
    assert.equal(outcome.ok, true);
    if (!outcome.ok) {
      return;
    }
    assert.equal(outcome.status, "applied");
    if (outcome.status === "applied") {
      assert.equal(outcome.baseDigest, review.baseDigest);
      assert.equal(outcome.resultSha256, review.resultSha256);
    }
    const written = readFileSync(addPath(root), "utf8");
    assert.equal(written, "def add(left, right):\n    return left + right\n");
    assert.equal(
      readFileSync(path.join(fixture, "add.py"), "utf8"),
      "def add(left, right):\n    return left + right + 1\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a concurrent edit conflicts and leaves the newer file intact", async () => {
  const root = copyFixture();
  try {
    const review = reviewOf(root);
    const newer = "def add(left, right):\n    return left + right + 1\n# local note\n";
    writeFileSync(addPath(root), newer);
    const outcome = await applyReviewedPatch(root, review, createDispatchGate());
    assert.equal(readFileSync(addPath(root), "utf8"), newer);
    assert.equal(outcome.ok, true);
    if (!outcome.ok || outcome.status !== "conflict") {
      assert.fail("expected a conflict");
    }
    assert.equal(outcome.path, "fixtures/failing-add/add.py");
    assert.equal(outcome.newerSha256, sha256(newer));
    assert.equal(outcome.review?.ok, true);
    if (outcome.review?.ok !== true) {
      return;
    }
    assert.equal(outcome.review.applied, false);
    assert.notEqual(outcome.review.baseDigest, review.baseDigest);
    assert.match(outcome.review.diff, /^\+    return left \+ right$/m);
    assert.match(outcome.review.rawLog, /\nOK\n/);

    const applied = await applyReviewedPatch(
      root,
      {
        baseDigest: outcome.review.baseDigest,
        resultSha256: outcome.review.resultSha256,
      },
      createDispatchGate(),
    );
    assert.equal(applied.ok, true);
    if (applied.ok) {
      assert.equal(applied.status, "applied");
    }
    assert.equal(
      readFileSync(addPath(root), "utf8"),
      "def add(left, right):\n    return left + right\n# local note\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a replaced sum conflicts without overwriting the newer line", async () => {
  const root = copyFixture();
  try {
    const review = reviewOf(root);
    const newer = "def add(left, right):\n    return left + right + 2\n";
    writeFileSync(addPath(root), newer);
    const outcome = await applyReviewedPatch(root, review, createDispatchGate());
    assert.equal(readFileSync(addPath(root), "utf8"), newer);
    assert.equal(outcome.ok, true);
    if (!outcome.ok || outcome.status !== "conflict") {
      assert.fail("expected a conflict");
    }
    assert.equal(outcome.review?.ok, false);
    if (outcome.review?.ok === false) {
      assert.equal(outcome.review.reason, "edit_not_bounded");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an edit to another reviewed file is a conflict", async () => {
  const root = copyFixture();
  try {
    const review = reviewOf(root);
    const testFile = path.join(root, "fixtures", "failing-add", "test_add.py");
    const newer = `${readFileSync(testFile, "utf8")}# local note\n`;
    writeFileSync(testFile, newer);
    const outcome = await applyReviewedPatch(root, review, createDispatchGate());
    assert.equal(readFileSync(addPath(root), "utf8").includes("+ 1"), true);
    assert.equal(readFileSync(testFile, "utf8"), newer);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.status, "conflict");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stop before the write cancels and does not change the file", async () => {
  const root = copyFixture();
  try {
    const review = reviewOf(root);
    const gate = createDispatchGate();
    const outcome = await applyReviewedPatch(root, review, gate, {
      beforeWrite() {
        gate.stop();
      },
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.status, "cancelled");
    }
    assert.match(readFileSync(addPath(root), "utf8"), /return left \+ right \+ 1/);
    const again = await applyReviewedPatch(root, review, gate);
    assert.equal(again.ok, true);
    if (again.ok) {
      assert.equal(again.status, "cancelled");
    }
    assert.match(readFileSync(addPath(root), "utf8"), /return left \+ right \+ 1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lost confirmation stays reconciling and is not called cancelled", async () => {
  const root = copyFixture();
  try {
    const review = reviewOf(root);
    const gate = createDispatchGate();
    const outcome = await applyReviewedPatch(root, review, gate, {
      readAfterWrite() {
        gate.stop();
        throw new Error("lost response");
      },
    });
    assert.equal(outcome.ok, true);
    if (!outcome.ok) {
      return;
    }
    assert.equal(outcome.status, "reconciling");
    const next = beginLocalDispatch(gate);
    assert.equal(next.ok, false);
    if (!next.ok) {
      assert.equal(next.status, "cancelled");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a review hash that does not match the edit is not written", async () => {
  const root = copyFixture();
  try {
    const review = reviewOf(root);
    const outcome = await applyReviewedPatch(
      root,
      { baseDigest: review.baseDigest, resultSha256: "c".repeat(64) },
      createDispatchGate(),
    );
    assert.deepEqual(outcome, { ok: false, reason: "review_mismatch" });
    assert.match(readFileSync(addPath(root), "utf8"), /return left \+ right \+ 1/);
    const invalid = await applyReviewedPatch(
      root,
      { baseDigest: "nope", resultSha256: "also-nope" },
      createDispatchGate(),
    );
    assert.deepEqual(invalid, { ok: false, reason: "invalid_review" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function copyFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "apply-reviewed-"));
  cpSync(fixture, path.join(root, "fixtures", "failing-add"), { recursive: true });
  return root;
}

function addPath(root: string): string {
  return path.join(root, "fixtures", "failing-add", "add.py");
}

function reviewOf(root: string): { baseDigest: string; resultSha256: string } {
  const before = readFileSync(addPath(root), "utf8");
  const edited = boundedSumEdit(before);
  if (edited === undefined) {
    throw new Error("fixture is not the bounded failing sum");
  }
  return {
    baseDigest: captureBaseRevision(root).digest,
    resultSha256: sha256(edited),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
