import {
  DISPATCH_SCHEMA_VERSION,
  KNOWN_TOOL_VERSION,
  parseDispatch,
} from "./dispatch.ts";
import type { DispatchEnvelope } from "./dispatch.ts";
import { MISSION_SCHEMA_VERSION, parseMission } from "./mission.ts";
import type { MissionProposal } from "./mission.ts";
import { isRecord, nonEmptyString, schemaVersion } from "./values.ts";

export type MissionReduction =
  | {
      ok: true;
      mission: MissionProposal;
      dispatch: DispatchEnvelope;
    }
  | {
      ok: false;
      reason: "unknown_schema_version" | "unknown_tool_version" | "invalid_request";
    };

// Mock reducer only. It checks the typed request and records the server tenant.
// It is not a planner, and it does not call a model or execute a tool.
export function reduceMission(
  request: unknown,
  serverTenantId: string,
): MissionReduction {
  const tenantId = nonEmptyString(serverTenantId);
  if (tenantId === undefined || !isRecord(request)) {
    return { ok: false, reason: "invalid_request" };
  }
  if (!Object.hasOwn(request, "mission") || !Object.hasOwn(request, "dispatch")) {
    return { ok: false, reason: "invalid_request" };
  }

  const missionVersion = schemaVersion(request.mission);
  const dispatchVersion = schemaVersion(request.dispatch);
  if (
    (missionVersion !== undefined && missionVersion !== MISSION_SCHEMA_VERSION) ||
    (dispatchVersion !== undefined && dispatchVersion !== DISPATCH_SCHEMA_VERSION)
  ) {
    return { ok: false, reason: "unknown_schema_version" };
  }

  if (isRecord(request.dispatch) && Object.hasOwn(request.dispatch, "tool_version")) {
    if (request.dispatch.tool_version !== KNOWN_TOOL_VERSION) {
      return { ok: false, reason: "unknown_tool_version" };
    }
  }

  const mission = parseMission(request.mission);
  const parsedDispatch = parseDispatch(request.dispatch);
  if (mission === undefined || parsedDispatch === undefined) {
    return { ok: false, reason: "invalid_request" };
  }

  return {
    ok: true,
    mission,
    dispatch: {
      ...parsedDispatch,
      tenant_id: tenantId,
    },
  };
}
