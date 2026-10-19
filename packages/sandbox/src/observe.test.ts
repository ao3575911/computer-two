import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EVENT_KEYS, parseEvent } from "../../protocol/src/event.ts";
import { observeFailingAddCheck } from "./observe.ts";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(packageRoot, "..", "..");
const addPath = path.join(repoRoot, "fixtures", "failing-add", "add.py");

test("the failing-add check is an observation in the mission timeline", async () => {
  const before = readFileSync(addPath, "utf8");
  const result = await observeFailingAddCheck(repoRoot);
  assert.equal(readFileSync(addPath, "utf8"), before);
  assert.match(before, /return left \+ right \+ 1/);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.deepEqual(
    result.events.map((event) => event.event_type),
    ["mission.created", "operation.dispatched", "operation.settled"],
  );
  assert.deepEqual(
    result.events.map((event) => event.sequence),
    [1, 2, 3],
  );
  for (const event of result.events) {
    assert.deepEqual(Object.keys(event).sort(), [...EVENT_KEYS].sort());
    assert.notEqual(parseEvent(event), undefined);
    assert.equal(event.mission_id, "failing-add");
  }
  assert.equal(
    result.events.some((event) => event.event_type === "mission.failed"),
    false,
  );
  assert.equal(
    result.events.some((event) => event.event_type === "mission.completed"),
    false,
  );

  const lines = result.timeline.flatMap((entry) => entry.lines);
  assert.equal(lines.includes("The check ran."), true);
  assert.equal(lines.includes("The check failed."), true);
  assert.equal(lines.includes("The failure is an observation."), true);
  const summary = lines.join("\n");
  assert.equal(summary.includes("Traceback"), false);
  assert.equal(summary.includes("/workspace/test_add.py"), false);
  assert.equal(summary.includes("AssertionError"), false);
  assert.match(result.rawLog, /File "\/workspace\/test_add\.py"/);
  assert.match(result.rawLog, /AssertionError: 6 != 5/);
  assert.match(result.rawLog, /FAILED \(failures=1\)/);
});
