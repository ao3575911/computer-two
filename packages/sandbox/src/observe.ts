import path from "node:path";
import { createEventLog, timelineLines } from "../../protocol/src/event-log.ts";
import type { MissionEvent } from "../../protocol/src/event.ts";
import { runFixtureUnittest } from "./tool.ts";
import type { SandboxFailure } from "./bwrap.ts";

export type CheckTimelineEntry = {
  sequence: number;
  event_type: string;
  lines: readonly string[];
};

export type FailingAddObservation =
  | {
      ok: true;
      events: MissionEvent[];
      timeline: CheckTimelineEntry[];
      rawLog: string;
    }
  | { ok: false; reason: "sandbox_unavailable" | "check_did_not_run" | "event_log_rejected" };

const MISSION_ID = "failing-add";

export async function observeFailingAddCheck(
  repoRoot: string,
): Promise<FailingAddObservation> {
  const ran = await runFixtureUnittest({
    root: path.join(repoRoot, "fixtures", "failing-add"),
    files: ["add.py", "test_add.py"],
  });
  if (!ran.ok) {
    return { ok: false, reason: failureReason(ran.reason) };
  }

  const log = createEventLog();
  const failed = ran.exitCode !== 0;
  const appended = [
    log.append({
      schema_version: "0.1",
      event_id: "failing-add-created",
      mission_id: MISSION_ID,
      sequence: 1,
      event_type: "mission.created",
      payload: { summary: "Failing-add is open." },
    }),
    log.append({
      schema_version: "0.1",
      event_id: "failing-add-dispatched",
      mission_id: MISSION_ID,
      sequence: 2,
      event_type: "operation.dispatched",
      payload: {
        summary: "The check ran.",
        check: "python3 -m unittest",
        fixture: "fixtures/failing-add",
      },
    }),
    log.append({
      schema_version: "0.1",
      event_id: "failing-add-settled",
      mission_id: MISSION_ID,
      sequence: 3,
      event_type: "operation.settled",
      payload: {
        summary: failed ? "The check failed." : "The check passed.",
        observation: failed
          ? "The failure is an observation."
          : "The result is an observation.",
        exit_code: ran.exitCode,
      },
    }),
  ];
  if (appended.some((result) => !result.ok)) {
    return { ok: false, reason: "event_log_rejected" };
  }

  const events = log.snapshot();
  return {
    ok: true,
    events,
    timeline: events.map((event) => ({
      sequence: event.sequence,
      event_type: event.event_type,
      lines: timelineLines(event),
    })),
    rawLog: `${ran.stdout}${ran.stderr}`,
  };
}

function failureReason(
  reason: SandboxFailure,
): "sandbox_unavailable" | "check_did_not_run" {
  switch (reason) {
    case "bubblewrap_missing":
      return "sandbox_unavailable";
    case "invalid_manifest":
    case "sandbox_error":
      return "check_did_not_run";
    default: {
      const unexpected: never = reason;
      return unexpected;
    }
  }
}
