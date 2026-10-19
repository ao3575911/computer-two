import assert from "node:assert/strict";
import test from "node:test";
import { EVENT_KEYS } from "./event.ts";
import { createEventLog, timelineLines } from "./event-log.ts";

function created(sequence: number, eventId = `event-${sequence}`) {
  return {
    schema_version: "0.1",
    event_id: eventId,
    mission_id: "failing-add",
    sequence,
    event_type: "mission.created",
    payload: { summary: "Failing-add is open." },
  };
}

test("a mission log only appends step 3 events", () => {
  const log = createEventLog();
  assert.deepEqual(log.append(created(1)), { ok: true });
  assert.deepEqual(
    log.append({ ...created(2, "event-2"), event_type: "operation.dispatched" }),
    { ok: true },
  );
  const events = log.snapshot();
  assert.equal(events.length, 2);
  assert.deepEqual(Object.keys(events[0] ?? {}).sort(), [...EVENT_KEYS].sort());
  assert.deepEqual(
    events.map((event) => event.sequence),
    [1, 2],
  );

  const rewritten = log.snapshot();
  const first = rewritten[0];
  assert.ok(first);
  first.payload.summary = "rewritten";
  first.sequence = 9;
  assert.equal(log.snapshot()[0]?.payload.summary, "Failing-add is open.");
  assert.equal(log.snapshot()[0]?.sequence, 1);
  assert.deepEqual(log.append(created(1, "event-again")), {
    ok: false,
    reason: "out_of_order",
  });
  assert.equal(log.snapshot().length, 2);
});

test("an extra event field or an authority-bearing payload field is rejected", () => {
  const log = createEventLog();
  assert.deepEqual(
    log.append({ ...created(1), tenant_id: "caller-tenant" }),
    { ok: false, reason: "invalid_event" },
  );
  assert.deepEqual(
    log.append({
      ...created(1),
      payload: { summary: "Failing-add is open.", grant_id: "forged" },
    }),
    { ok: false, reason: "authority_field" },
  );
  assert.deepEqual(log.snapshot(), []);
  assert.deepEqual(log.append(created(1)), { ok: true });
  assert.deepEqual(log.append({ ...created(2, "event-1"), event_type: "operation.settled" }), {
    ok: false,
    reason: "duplicate_event_id",
  });
  assert.deepEqual(
    log.append({
      ...created(2, "event-2"),
      mission_id: "other-mission",
      event_type: "operation.settled",
    }),
    { ok: false, reason: "mission_mismatch" },
  );
  assert.equal(log.snapshot().length, 1);
});

test("the timeline summary ignores unknown optional payload fields", () => {
  const lines = timelineLines({
    event_type: "operation.settled",
    payload: {
      summary: "The check failed.",
      observation: "The failure is an observation.",
      note: "ignore-me",
      raw_log: "Traceback (most recent call last):",
      exit_code: 1,
    },
  });
  assert.deepEqual(lines, [
    "The check failed.",
    "The failure is an observation.",
  ]);
  assert.equal(lines.join("\n").includes("ignore-me"), false);
  assert.equal(lines.join("\n").includes("Traceback"), false);
});
