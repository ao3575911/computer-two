export type ShownEvent = {
  sequence: number;
  event_type: string;
  payload: Record<string, unknown>;
};

export type ShownCheck = {
  events: ShownEvent[];
  rawLog: string;
};

export function parseCheckResult(body: string): ShownCheck | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.ok !== true || typeof value.rawLog !== "string") {
    return undefined;
  }
  if (!Array.isArray(value.events)) {
    return undefined;
  }
  const events: ShownEvent[] = [];
  for (const item of value.events) {
    if (
      !isRecord(item) ||
      typeof item.sequence !== "number" ||
      typeof item.event_type !== "string" ||
      !isRecord(item.payload)
    ) {
      return undefined;
    }
    events.push({
      sequence: item.sequence,
      event_type: item.event_type,
      payload: item.payload,
    });
  }
  events.sort((left, right) => left.sequence - right.sequence);
  return { events, rawLog: value.rawLog };
}

export function errorText(error: unknown): string {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "The check could not run.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
