import { EVENT_SCHEMA_VERSION, parseEvent } from "./event.ts";
import type { MissionEvent } from "./event.ts";

const AUTHORITY_PAYLOAD_KEYS = [
  "tenant_id",
  "grant_id",
  "policy_version",
  "fencing_token",
  "budget_reservation_id",
  "request_digest",
] as const;

export type AppendFailure =
  | "invalid_event"
  | "authority_field"
  | "out_of_order"
  | "duplicate_event_id"
  | "mission_mismatch";

export type AppendResult = { ok: true } | { ok: false; reason: AppendFailure };

export type EventLog = {
  append(event: unknown): AppendResult;
  snapshot(): MissionEvent[];
};

export function createEventLog(): EventLog {
  const events: MissionEvent[] = [];
  return {
    append(event: unknown): AppendResult {
      const parsed = parseEvent(event);
      if (parsed === undefined) {
        return { ok: false, reason: "invalid_event" };
      }
      if (hasAuthorityField(parsed.payload)) {
        return { ok: false, reason: "authority_field" };
      }
      if (parsed.sequence !== events.length + 1) {
        return { ok: false, reason: "out_of_order" };
      }
      if (events.some((existing) => existing.event_id === parsed.event_id)) {
        return { ok: false, reason: "duplicate_event_id" };
      }
      const missionId = events[0]?.mission_id;
      if (missionId !== undefined && parsed.mission_id !== missionId) {
        return { ok: false, reason: "mission_mismatch" };
      }
      events.push({
        schema_version: EVENT_SCHEMA_VERSION,
        event_id: parsed.event_id,
        mission_id: parsed.mission_id,
        sequence: parsed.sequence,
        event_type: parsed.event_type,
        payload: { ...parsed.payload },
      });
      return { ok: true };
    },
    snapshot(): MissionEvent[] {
      return events.map((event) => ({
        schema_version: event.schema_version,
        event_id: event.event_id,
        mission_id: event.mission_id,
        sequence: event.sequence,
        event_type: event.event_type,
        payload: { ...event.payload },
      }));
    },
  };
}

export function timelineLines(event: {
  event_type: string;
  payload: Record<string, unknown>;
}): string[] {
  const lines: string[] = [];
  const summary = event.payload.summary;
  const observation = event.payload.observation;
  if (typeof summary === "string" && summary.length > 0) {
    lines.push(summary);
  }
  if (typeof observation === "string" && observation.length > 0) {
    lines.push(observation);
  }
  if (lines.length === 0) {
    lines.push(event.event_type);
  }
  return lines;
}

function hasAuthorityField(payload: Record<string, unknown>): boolean {
  return AUTHORITY_PAYLOAD_KEYS.some((key) => Object.hasOwn(payload, key));
}
