import type { ShownDiff } from "./diff-result";

export type ApplyPhase =
  | "idle"
  | "applying"
  | "stopping"
  | "applied"
  | "conflict"
  | "cancelled"
  | "reconciling"
  | "error";

type DiffScreenProps = {
  buildVersion: string;
  status: "running" | "ready" | "error";
  diff: ShownDiff | undefined;
  message: string;
  applyPhase: ApplyPhase;
  newerSha256: string;
  reviewReady: boolean;
  applyEnabled: boolean;
  onApply: () => void;
  onStop: () => void;
  onBack: () => void;
};

export default function DiffScreen({
  buildVersion,
  status,
  diff,
  message,
  applyPhase,
  newerSha256,
  reviewReady,
  applyEnabled,
  onApply,
  onStop,
  onBack,
}: DiffScreenProps) {
  const passed = diff !== undefined && diff.exitCode === 0;
  return (
    <main className="screen timeline-screen">
      <h1 aria-label="Computer Two">
        <span aria-hidden="true">Computer II</span>
      </h1>
      <p className="product">C:2 Terminal</p>
      <h2>Diff</h2>
      {status === "running" && applyPhase !== "stopping" ? (
        <p className="note">Preparing the diff.</p>
      ) : null}
      {status === "error" ? <p className="note">{message}</p> : null}
      {status === "ready" && diff !== undefined ? (
        <>
          <p className="note">Base revision {diff.digest}</p>
          <p className="note">Result revision {diff.resultSha256}</p>
          <pre className="raw-log" aria-label="Diff">
            {diff.diff}
          </pre>
          <p className="note">
            {passed
              ? "python3 -m unittest passed inside the slice 1 sandbox."
              : "python3 -m unittest did not pass inside the slice 1 sandbox."}
          </p>
          <p className="note" role="status">
            {applyStatus(applyPhase, message, newerSha256, reviewReady)}
          </p>
          <h2>Raw log</h2>
          <pre className="raw-log" aria-label="Raw log">
            {diff.rawLog}
          </pre>
        </>
      ) : null}
      {status !== "ready" && applyPhase !== "idle" ? (
        <p className="note" role="status">
          {applyStatus(applyPhase, message, newerSha256, reviewReady)}
        </p>
      ) : null}
      <div className="actions">
        <button type="button" onClick={onApply} disabled={!applyEnabled}>
          Apply
        </button>
        <button type="button" onClick={onStop}>
          Stop
        </button>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
      <p className="build">Build {buildVersion}</p>
    </main>
  );
}

function applyStatus(
  phase: ApplyPhase,
  message: string,
  newerSha256: string,
  reviewReady: boolean,
): string {
  switch (phase) {
    case "idle":
      return "The patch was not applied.";
    case "applying":
      return "Applying.";
    case "stopping":
      return "Stopping.";
    case "applied":
      return "Applied. The base matched the review, so the patch was written.";
    case "conflict": {
      const intact =
        newerSha256.length > 0
          ? `Conflict. The newer file was left intact. Newer revision ${newerSha256}.`
          : "Conflict. The newer file was left intact.";
      return reviewReady ? `${intact} A new diff is ready to review.` : intact;
    }
    case "cancelled":
      return "Cancelled. The patch was not applied.";
    case "reconciling":
      return "Reconciling. Cancellation is not claimed.";
    case "error":
      return message;
    default: {
      const unexpected: never = phase;
      return unexpected;
    }
  }
}
