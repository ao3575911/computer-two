import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DISPATCH_KEYS, DISPATCH_SCHEMA_VERSION } from "./dispatch.ts";
import { mockPlan } from "./mock-plan.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readMission(): unknown {
  return JSON.parse(readFileSync(join(packageRoot, "mission.example.json"), "utf8"));
}

function fixedPlan(tenantId: string) {
  return {
    schema_version: "0.2" as const,
    tenant_id: tenantId,
    mission_id: "demo-024",
    run_id: "fixed-run",
    operation_id: "fixed-operation",
    fencing_token: "1",
    tool_id: "fixture",
    tool_version: "0.1" as const,
    arguments: {},
    scope: "fixture",
    location: "cloud" as const,
    grant_id: "fixed-grant",
    policy_version: "0.1",
    issued_at: "2026-10-19T00:00:00Z",
    expires_at: "2026-10-19T00:01:00Z",
    request_digest: "fixed-digest",
    budget_reservation_id: "fixed-reservation",
    trace_id: "fixed-trace",
  };
}

test("the emitted plan is the fixed dispatch envelope", () => {
  const result = mockPlan(
    {
      tenant_id: "caller-tenant",
      mission: readMission(),
      dispatch: {
        schema_version: DISPATCH_SCHEMA_VERSION,
        tenant_id: "caller-tenant",
        mission_id: "some-other-mission",
        run_id: "request-run",
        operation_id: "request-operation",
        tool_version: "0.1",
      },
    },
    "server-tenant",
  );
  assert.deepEqual(result, { ok: true, plan: fixedPlan("server-tenant") });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(Object.keys(result.plan).sort(), [...DISPATCH_KEYS].sort());
  assert.equal(result.plan.run_id, "fixed-run");
  assert.equal(result.plan.tenant_id, "server-tenant");
  assert.equal(JSON.stringify(result).includes("caller-tenant"), false);
  assert.equal(JSON.stringify(result).includes("request-run"), false);
});

test("an unknown schema version fails closed", () => {
  const result = mockPlan(
    {
      mission: readMission(),
      dispatch: {
        schema_version: "9.9",
        tool_version: "0.1",
      },
    },
    "server-tenant",
  );
  assert.deepEqual(result, { ok: false, reason: "unknown_schema_version" });
  assert.equal("plan" in result, false);
});

test("an unknown tool version fails closed", () => {
  const result = mockPlan(
    {
      mission: readMission(),
      dispatch: {
        schema_version: DISPATCH_SCHEMA_VERSION,
        tool_version: "9.9",
      },
    },
    "server-tenant",
  );
  assert.deepEqual(result, { ok: false, reason: "unknown_tool_version" });
  assert.equal("plan" in result, false);
});

test("no tool runs", () => {
  const result = mockPlan(
    {
      mission: readMission(),
      dispatch: { schema_version: DISPATCH_SCHEMA_VERSION, tool_version: "0.1" },
    },
    "server-tenant",
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.plan.arguments, {});
  assert.equal("tool_result" in result, false);
  assert.equal("tool_result" in result.plan, false);
  assert.equal("executed" in result, false);
  const again = mockPlan(
    {
      mission: readMission(),
      dispatch: { schema_version: DISPATCH_SCHEMA_VERSION, tool_version: "0.1" },
    },
    "server-tenant",
  );
  assert.deepEqual(again, result);
});
