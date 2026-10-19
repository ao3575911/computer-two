import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DISPATCH_KEYS, DISPATCH_SCHEMA_VERSION } from "./dispatch.ts";
import { EVENT_KEYS, EVENT_TYPES, parseEvent } from "./event.ts";
import { MISSION_KEYS } from "./mission.ts";
import { reduceMission } from "./reduce-mission.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

type JsonRecord = Record<string, unknown>;

function readJson(name: string): JsonRecord {
  const parsed: unknown = JSON.parse(readFileSync(join(packageRoot, name), "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} is not an object`);
  }
  return parsed as JsonRecord;
}

function validDispatch(tenantId: string): JsonRecord {
  return {
    schema_version: DISPATCH_SCHEMA_VERSION,
    tenant_id: tenantId,
    mission_id: "demo-024",
    run_id: "run-1",
    operation_id: "op-1",
    fencing_token: "1",
    tool_id: "fixture",
    tool_version: "0.1",
    arguments: {},
    scope: "fixture",
    location: "cloud",
    grant_id: "grant-1",
    policy_version: "0.1",
    issued_at: "2026-10-19T00:00:00Z",
    expires_at: "2026-10-19T00:01:00Z",
    request_digest: "digest-1",
    budget_reservation_id: "reservation-1",
    trace_id: "trace-1",
  };
}

test("starter schemas keep the fields they define", () => {
  const mission = readJson("mission.schema.json");
  const event = readJson("event.schema.json");
  const dispatch = readJson("dispatch.schema.json");
  assert.deepEqual(mission.required, [...MISSION_KEYS]);
  assert.deepEqual(event.required, [...EVENT_KEYS]);
  assert.deepEqual(dispatch.required, [...DISPATCH_KEYS]);
  const eventProperties = event.properties;
  assert.equal(typeof eventProperties, "object");
  assert.ok(eventProperties !== null && !Array.isArray(eventProperties));
  const eventType = (eventProperties as JsonRecord).event_type;
  assert.equal(typeof eventType, "object");
  assert.ok(eventType !== null && !Array.isArray(eventType));
  assert.deepEqual((eventType as JsonRecord).enum, [...EVENT_TYPES]);
});

test("a valid request is recorded and no tool runs", () => {
  const mission = readJson("mission.example.json");
  const result = reduceMission(
    { mission, dispatch: validDispatch("session-tenant") },
    "session-tenant",
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.mission.mission_id, "demo-024");
  assert.equal(result.mission.location, "cloud");
  assert.equal(result.mission.budget_units, 200);
  assert.deepEqual(result.mission.success_checks, [
    "existing regression suite passes",
    "independent checkout fixture passes",
  ]);
  assert.equal(result.dispatch.tenant_id, "session-tenant");
  assert.equal(result.dispatch.tool_version, "0.1");
  assert.equal(result.dispatch.schema_version, "0.2");
  assert.equal("plan" in result, false);
});

test("an unknown schema version fails closed", () => {
  const mission = readJson("mission.example.json");
  const dispatch = validDispatch("session-tenant");
  dispatch.schema_version = "9.9";
  const result = reduceMission({ mission, dispatch }, "session-tenant");
  assert.deepEqual(result, { ok: false, reason: "unknown_schema_version" });
});

test("an unknown tool version fails closed", () => {
  const mission = readJson("mission.example.json");
  const dispatch = validDispatch("session-tenant");
  dispatch.tool_version = "9.9";
  const result = reduceMission({ mission, dispatch }, "session-tenant");
  assert.deepEqual(result, { ok: false, reason: "unknown_tool_version" });
});

test("a caller-supplied tenant id is ignored", () => {
  const mission = readJson("mission.example.json");
  const result = reduceMission(
    {
      tenant_id: "caller-tenant",
      mission,
      dispatch: validDispatch("dispatch-caller-tenant"),
    },
    "session-tenant",
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.dispatch.tenant_id, "session-tenant");
  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes("caller-tenant"), false);
  assert.equal(encoded.includes("dispatch-caller-tenant"), false);
});

test("the starter event shape parses and rejects an extra field", () => {
  const parsed = parseEvent({
    schema_version: "0.1",
    event_id: "event-1",
    mission_id: "demo-024",
    sequence: 1,
    event_type: "mission.created",
    payload: {},
  });
  assert.equal(parsed?.event_type, "mission.created");
  const rejected = parseEvent({
    schema_version: "0.1",
    event_id: "event-1",
    mission_id: "demo-024",
    sequence: 1,
    event_type: "mission.created",
    payload: {},
    tenant_id: "caller-tenant",
  });
  assert.equal(rejected, undefined);
});
