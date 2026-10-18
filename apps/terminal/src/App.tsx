import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

export default function App() {
  const [buildVersion, setBuildVersion] = useState(
    __COMPUTER_TWO_BUILD_VERSION__,
  );

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

  return (
    <main className="screen">
      <h1 aria-label="Computer Two">
        <span aria-hidden="true">Computer II</span>
      </h1>
      <p className="product">C:2 Terminal</p>
      <p className="note">These actions do not run in this build.</p>
      <div className="actions">
        <button type="button" disabled>
          Open folder
        </button>
        <button type="button" disabled>
          Start sample mission
        </button>
        <button type="button" disabled>
          Open shell
        </button>
      </div>
      <p className="build">Build {buildVersion}</p>
    </main>
  );
}
