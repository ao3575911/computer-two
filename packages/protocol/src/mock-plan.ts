import { DISPATCH_SCHEMA_VERSION, KNOWN_TOOL_VERSION } from "./dispatch.ts";
import type { DispatchEnvelope } from "./dispatch.ts";
import { MISSION_SCHEMA_VERSION } from "./mission.ts";
import { isRecord, nonEmptyString, schemaVersion } from "./values.ts";

export type MockPlan =
  | {
      ok: true;
      plan: DispatchEnvelope;
    }
  | {
      ok: false;
      reason: "unknown_schema_version" | "unknown_tool_version" | "invalid_request";
    };

// One fixed dispatch envelope. The server tenant is filled in at emission.
// Nothing in this module calls a model or runs a tool.
const FIXED_PLAN = {
  schema_version: DISPATCH_SCHEMA_VERSION,
  mission_id: "demo-024",
  run_id: "fixed-run",
  operation_id: "fixed-operation",
  fencing_token: "1",
  tool_id: "fixture",
  tool_version: KNOWN_TOOL_VERSION,
  arguments: {},
  scope: "fixture",
  location: "cloud",
  grant_id: "fixed-grant",
  policy_version: "0.1",
  issued_at: "2026-10-19T00:00:00Z",
  expires_at: "2026-10-19T00:01:00Z",
  request_digest: "fixed-digest",
  budget_reservation_id: "fixed-reservation",
  trace_id: "fixed-trace",
} as const;

export function mockPlan(request: unknown, serverTenantId: string): MockPlan {
  const tenantId = nonEmptyString(serverTenantId);
  if (tenantId === undefined) {
    return { ok: false, reason: "invalid_request" };
  }
  const failure = versionFailure(request);
  if (failure !== undefined) {
    return { ok: false, reason: failure };
  }
  return {
    ok: true,
    plan: {
      ...FIXED_PLAN,
      tenant_id: tenantId,
    },
  };
}

function versionFailure(
  request: unknown,
): "unknown_schema_version" | "unknown_tool_version" | undefined {
  if (!isRecord(request)) {
    return undefined;
  }
  if (unknownSchema(schemaVersion(request), [MISSION_SCHEMA_VERSION, DISPATCH_SCHEMA_VERSION])) {
    return "unknown_schema_version";
  }
  if (unknownTool(request)) {
    return "unknown_tool_version";
  }
  if (!isRecord(request.mission) && !isRecord(request.dispatch)) {
    return undefined;
  }
  if (unknownSchema(schemaVersion(request.mission), [MISSION_SCHEMA_VERSION])) {
    return "unknown_schema_version";
  }
  if (unknownSchema(schemaVersion(request.dispatch), [DISPATCH_SCHEMA_VERSION])) {
    return "unknown_schema_version";
  }
  if (isRecord(request.dispatch) && unknownTool(request.dispatch)) {
    return "unknown_tool_version";
  }
  return undefined;
}

function unknownSchema(version: string | undefined, known: readonly string[]): boolean {
  return version !== undefined && !known.includes(version);
}

function unknownTool(value: Record<string, unknown>): boolean {
  return Object.hasOwn(value, "tool_version") && value.tool_version !== KNOWN_TOOL_VERSION;
}
