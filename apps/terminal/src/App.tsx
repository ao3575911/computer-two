import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import ShellView from "./ShellView";
import { sessionModeLabel, type SessionMode } from "./session-mode";

type Screen = "home" | "session";

export default function App() {
  const [buildVersion, setBuildVersion] = useState(
    __COMPUTER_TWO_BUILD_VERSION__,
  );
  const [screen, setScreen] = useState<Screen>("home");
  const [mode, setMode] = useState<SessionMode>("shell");
  const [announcement, setAnnouncement] = useState("");
  const [draft, setDraft] = useState("");
  const [plannerNotice, setPlannerNotice] = useState("");

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
          </div>
          <p className="build">Build {buildVersion}</p>
        </main>
      ) : (
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
      )}
    </>
  );
}
