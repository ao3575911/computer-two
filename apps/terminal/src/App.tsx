import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { errorText, parseCheckResult, type ShownCheck } from "./check-result";
import { parseDiffResult, type ShownDiff } from "./diff-result";
import DiffScreen from "./DiffScreen";
import ShellView from "./ShellView";
import { sessionModeLabel, type SessionMode } from "./session-mode";
import TimelineScreen from "./TimelineScreen";

type Screen = "home" | "session" | "timeline" | "diff";
type CheckStatus = "running" | "ready" | "error";

export default function App() {
  const [buildVersion, setBuildVersion] = useState(
    __COMPUTER_TWO_BUILD_VERSION__,
  );
  const [screen, setScreen] = useState<Screen>("home");
  const [mode, setMode] = useState<SessionMode>("shell");
  const [announcement, setAnnouncement] = useState("");
  const [draft, setDraft] = useState("");
  const [plannerNotice, setPlannerNotice] = useState("");
  const [checkStatus, setCheckStatus] = useState<CheckStatus>("running");
  const [check, setCheck] = useState<ShownCheck | undefined>(undefined);
  const [checkMessage, setCheckMessage] = useState("");
  const [diffStatus, setDiffStatus] = useState<CheckStatus>("running");
  const [diffView, setDiffView] = useState<ShownDiff | undefined>(undefined);
  const [diffMessage, setDiffMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getVersion()
      .then((version) => {
        if (!cancelled) {
          setBuildVersion(version);
        }
      })
      .catch(() => {
        // Keep the version compiled from tauri.conf.json.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function selectMode(next: SessionMode) {
    setMode(next);
    setAnnouncement(sessionModeLabel(next));
  }

  function openShell() {
    setScreen("session");
    selectMode("shell");
  }

  function runFailingAddCheck() {
    setScreen("timeline");
    setCheckStatus("running");
    setCheck(undefined);
    setCheckMessage("");
    void invoke<string>("run_failing_add_check")
      .then((body) => {
        const parsed = parseCheckResult(body);
        if (parsed === undefined) {
          setCheckStatus("error");
          setCheckMessage("The check did not return mission events.");
          return;
        }
        setCheck(parsed);
        setCheckStatus("ready");
      })
      .catch((error: unknown) => {
        setCheckStatus("error");
        setCheckMessage(errorText(error));
      });
  }

  function showFailingAddDiff() {
    setScreen("diff");
    setDiffStatus("running");
    setDiffView(undefined);
    setDiffMessage("");
    void invoke<string>("show_failing_add_diff")
      .then((body) => {
        const parsed = parseDiffResult(body);
        if (parsed === undefined) {
          setDiffStatus("error");
          setDiffMessage("The diff did not return a base revision.");
          return;
        }
        setDiffView(parsed);
        setDiffStatus("ready");
      })
      .catch((error: unknown) => {
        setDiffStatus("error");
        setDiffMessage(errorText(error));
      });
  }

  return (
    <>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {screen === "home" ? (
        <main className="screen">
          <h1 aria-label="Computer Two">
            <span aria-hidden="true">Computer II</span>
          </h1>
          <p className="product">C:2 Terminal</p>
          <p className="note">
            Open folder and Start sample mission do not run in this build.
          </p>
          <div className="actions">
            <button type="button" disabled>
              Open folder
            </button>
            <button type="button" disabled>
              Start sample mission
            </button>
            <button type="button" onClick={openShell}>
              Open shell
            </button>
            <button type="button" onClick={runFailingAddCheck}>
              Run failing-add check
            </button>
            <button type="button" onClick={showFailingAddDiff}>
              Show failing-add diff
            </button>
          </div>
          <p className="build">Build {buildVersion}</p>
        </main>
      ) : null}
      {screen === "session" ? (
        <ShellView
          mode={mode}
          draft={draft}
          plannerNotice={plannerNotice}
          buildVersion={buildVersion}
          onMode={selectMode}
          onDraft={setDraft}
          onSubmitIntent={() => {
            setPlannerNotice("No planner is connected.");
          }}
        />
      ) : null}
      {screen === "timeline" ? (
        <TimelineScreen
          buildVersion={buildVersion}
          status={checkStatus}
          check={check}
          message={checkMessage}
          onBack={() => {
            setScreen("home");
          }}
        />
      ) : null}
      {screen === "diff" ? (
        <DiffScreen
          buildVersion={buildVersion}
          status={diffStatus}
          diff={diffView}
          message={diffMessage}
          onBack={() => {
            setScreen("home");
          }}
        />
      ) : null}
    </>
  );
}
