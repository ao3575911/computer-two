import type { ShownDiff } from "./diff-result";

type DiffScreenProps = {
  buildVersion: string;
  status: "running" | "ready" | "error";
  diff: ShownDiff | undefined;
  message: string;
  onBack: () => void;
};

export default function DiffScreen({
  buildVersion,
  status,
  diff,
  message,
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
      {status === "running" ? <p className="note">Preparing the diff.</p> : null}
      {status === "error" ? <p className="note">{message}</p> : null}
      {status === "ready" && diff !== undefined ? (
        <>
          <p className="note">Base revision {diff.digest}</p>
          <pre className="raw-log" aria-label="Diff">
            {diff.diff}
          </pre>
          <p className="note">
            {passed
              ? "python3 -m unittest passed inside the slice 1 sandbox."
              : "python3 -m unittest did not pass inside the slice 1 sandbox."}
          </p>
          <p className="note">The patch was not applied.</p>
          <h2>Raw log</h2>
          <pre className="raw-log" aria-label="Raw log">
            {diff.rawLog}
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
