import type { ShownCheck } from "./check-result";
import { timelineLines } from "./timeline-lines";

type TimelineScreenProps = {
  buildVersion: string;
  status: "running" | "ready" | "error";
  check: ShownCheck | undefined;
  message: string;
  onBack: () => void;
};

export default function TimelineScreen({
  buildVersion,
  status,
  check,
  message,
  onBack,
}: TimelineScreenProps) {
  return (
    <main className="screen timeline-screen">
      <h1 aria-label="Computer Two">
        <span aria-hidden="true">Computer II</span>
      </h1>
      <p className="product">C:2 Terminal</p>
      <h2>Timeline</h2>
      {status === "running" ? <p className="note">Running the check.</p> : null}
      {status === "error" ? <p className="note">{message}</p> : null}
      {status === "ready" && check !== undefined ? (
        <>
          <ol className="timeline" aria-label="Timeline">
            {check.events.map((event) => (
              <li key={event.sequence}>
                <p className="timeline-type">
                  {event.sequence}. {event.event_type}
                </p>
                {timelineLines(event).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </li>
            ))}
          </ol>
          <p className="note">No diff is applied.</p>
          <h2>Raw log</h2>
          <pre className="raw-log" aria-label="Raw log">
            {check.rawLog}
          </pre>
        </>
      ) : null}
      <div className="actions">
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
      <p className="build">Build {buildVersion}</p>
    </main>
  );
}
