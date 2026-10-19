import {
  hasExactKeys,
  isRecord,
  nonEmptyString,
  positiveInteger,
} from "./values.ts";

export const EVENT_SCHEMA_VERSION = "0.1";

export const EVENT_KEYS = [
  "schema_version",
  "event_id",
  "mission_id",
  "sequence",
  "event_type",
  "payload",
] as const;

export const EVENT_TYPES = [
  "mission.created",
  "operation.dispatched",
  "operation.settled",
  "operation.reconciling",
  "grant.revoked",
  "mission.cancelled",
  "mission.completed",
  "mission.failed",
] as const;

export type MissionEventType = (typeof EVENT_TYPES)[number];

export type MissionEvent = {
  schema_version: typeof EVENT_SCHEMA_VERSION;
  event_id: string;
  mission_id: string;
  sequence: number;
  event_type: MissionEventType;
  payload: Record<string, unknown>;
};

export function parseEvent(value: unknown): MissionEvent | undefined {
  if (!isRecord(value) || !hasExactKeys(value, EVENT_KEYS)) {
    return undefined;
  }
  if (value.schema_version !== EVENT_SCHEMA_VERSION) {
    return undefined;
  }
  const eventId = nonEmptyString(value.event_id);
  const missionId = nonEmptyString(value.mission_id);
  const sequence = positiveInteger(value.sequence);
  const eventType = eventTypeValue(value.event_type);
  if (!isRecord(value.payload)) {
    return undefined;
  }
  if (
    eventId === undefined ||
    missionId === undefined ||
    sequence === undefined ||
    eventType === undefined
  ) {
    return undefined;
  }
  return {
    schema_version: EVENT_SCHEMA_VERSION,
    event_id: eventId,
    mission_id: missionId,
    sequence,
    event_type: eventType,
    payload: value.payload,
  };
}

function eventTypeValue(value: unknown): MissionEventType | undefined {
  switch (value) {
    case "mission.created":
    case "operation.dispatched":
    case "operation.settled":
    case "operation.reconciling":
    case "grant.revoked":
    case "mission.cancelled":
    case "mission.completed":
    case "mission.failed":
      return value;
    default:
      return undefined;
  }
}
