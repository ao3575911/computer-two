import {
  hasExactKeys,
  isRecord,
  locationValue,
  nonEmptyString,
} from "./values.ts";
import type { MissionLocation } from "./mission.ts";

export const DISPATCH_SCHEMA_VERSION = "0.2";
export const KNOWN_TOOL_VERSION = "0.1";

export const DISPATCH_KEYS = [
  "schema_version",
  "tenant_id",
  "mission_id",
  "run_id",
  "operation_id",
  "fencing_token",
  "tool_id",
  "tool_version",
  "arguments",
  "scope",
  "location",
  "grant_id",
  "policy_version",
  "issued_at",
  "expires_at",
  "request_digest",
  "budget_reservation_id",
  "trace_id",
] as const;

export type DispatchEnvelope = {
  schema_version: typeof DISPATCH_SCHEMA_VERSION;
  tenant_id: string;
  mission_id: string;
  run_id: string;
  operation_id: string;
  fencing_token: string;
  tool_id: string;
  tool_version: typeof KNOWN_TOOL_VERSION;
  arguments: Record<string, unknown>;
  scope: string;
  location: MissionLocation;
  grant_id: string;
  policy_version: string;
  issued_at: string;
  expires_at: string;
  request_digest: string;
  budget_reservation_id: string;
  trace_id: string;
};

export function parseDispatch(value: unknown): DispatchEnvelope | undefined {
  if (!isRecord(value) || !hasExactKeys(value, DISPATCH_KEYS)) {
    return undefined;
  }
  if (value.schema_version !== DISPATCH_SCHEMA_VERSION) {
    return undefined;
  }
  if (value.tool_version !== KNOWN_TOOL_VERSION) {
    return undefined;
  }
  const tenantId = nonEmptyString(value.tenant_id);
  const missionId = nonEmptyString(value.mission_id);
  const runId = nonEmptyString(value.run_id);
  const operationId = nonEmptyString(value.operation_id);
  const fencingToken = nonEmptyString(value.fencing_token);
  const toolId = nonEmptyString(value.tool_id);
  const scope = nonEmptyString(value.scope);
  const location = locationValue(value.location);
  const grantId = nonEmptyString(value.grant_id);
  const policyVersion = nonEmptyString(value.policy_version);
  const issuedAt = nonEmptyString(value.issued_at);
  const expiresAt = nonEmptyString(value.expires_at);
  const requestDigest = nonEmptyString(value.request_digest);
  const budgetReservationId = nonEmptyString(value.budget_reservation_id);
  const traceId = nonEmptyString(value.trace_id);
  if (!isRecord(value.arguments)) {
    return undefined;
  }
  if (
    tenantId === undefined ||
    missionId === undefined ||
    runId === undefined ||
    operationId === undefined ||
    fencingToken === undefined ||
    toolId === undefined ||
    scope === undefined ||
    location === undefined ||
    grantId === undefined ||
    policyVersion === undefined ||
    issuedAt === undefined ||
    expiresAt === undefined ||
    requestDigest === undefined ||
    budgetReservationId === undefined ||
    traceId === undefined
  ) {
    return undefined;
  }
  return {
    schema_version: DISPATCH_SCHEMA_VERSION,
    tenant_id: tenantId,
    mission_id: missionId,
    run_id: runId,
    operation_id: operationId,
    fencing_token: fencingToken,
    tool_id: toolId,
    tool_version: KNOWN_TOOL_VERSION,
    arguments: value.arguments,
    scope,
    location,
    grant_id: grantId,
    policy_version: policyVersion,
    issued_at: issuedAt,
    expires_at: expiresAt,
    request_digest: requestDigest,
    budget_reservation_id: budgetReservationId,
    trace_id: traceId,
  };
}
