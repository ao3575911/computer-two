import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { sessionModeLabel, type SessionMode } from "./session-mode";

type ShellViewProps = {
  mode: SessionMode;
  draft: string;
  plannerNotice: string;
  buildVersion: string;
  onMode: (mode: SessionMode) => void;
  onDraft: (draft: string) => void;
  onSubmitIntent: () => void;
};

export default function ShellView({
  mode,
  draft,
  plannerNotice,
  buildVersion,
  onMode,
  onDraft,
  onSubmitIntent,
}: ShellViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const modeRef = useRef(mode);
  const [shellError, setShellError] = useState("");
  modeRef.current = mode;

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "DejaVu Sans Mono, WenQuanYi Micro Hei Mono, monospace",
      fontSize: 14,
      theme: {
        background: "#1c1c1c",
        foreground: "#f3f3f1",
        cursor: "#f3f3f1",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;

    let shellReady = false;
    const dataSubscription = terminal.onData((data) => {
      if (modeRef.current !== "shell") {
        return;
      }
      const bytes = Array.from(new TextEncoder().encode(data));
      void invoke("write_pty", { data: bytes });
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      if (!shellReady || cols < 1 || rows < 1) {
        return;
      }
      void invoke("resize_pty", { cols, rows });
    });

    const observer = new ResizeObserver(() => {
      fitTerminal(fit);
    });
    observer.observe(host);

    let cancelled = false;
    let unlistenOutput: (() => void) | undefined;
    let unlistenClosed: (() => void) | undefined;

    void (async () => {
      unlistenOutput = await listen<number[]>("pty-output", (event) => {
        const bytes = asBytes(event.payload);
        if (bytes !== null) {
          terminal.write(bytes);
        }
      });
      unlistenClosed = await listen("pty-closed", () => {
        terminal.write("\r\n[shell exited]\r\n");
      });
      if (cancelled) {
        unlistenOutput();
        unlistenClosed();
        return;
      }
      const size = await waitForSize(terminal, fit);
      try {
        await invoke("open_shell", size);
        shellReady = true;
        terminal.focus();
      } catch (error) {
        setShellError(errorText(error));
      }
    })();

    return () => {
      cancelled = true;
      shellReady = false;
      unlistenOutput?.();
      unlistenClosed?.();
      observer.disconnect();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal === null) {
      return;
    }
    if (mode === "shell") {
      terminal.options.disableStdin = false;
      terminal.focus();
      return;
    }
    terminal.options.disableStdin = true;
    terminal.blur();
  }, [mode]);

  return (
    <section className="session" aria-label="Computer Two">
      <header className="session-bar">
        <p className="wordmark">
          <span aria-hidden="true">Computer II</span>
          <span className="visually-hidden">Computer Two</span>
        </p>
        <p className="product">C:2 Terminal</p>
        <p className="build">Build {buildVersion}</p>
      </header>
      <fieldset className="mode">
        <legend>Mode</legend>
        <label>
          <input
            type="radio"
            name="session-mode"
            checked={mode === "shell"}
            onChange={() => {
              onMode("shell");
            }}
          />
          Shell
        </label>
        <label>
          <input
            type="radio"
            name="session-mode"
            checked={mode === "intent"}
            onChange={() => {
              onMode("intent");
            }}
          />
          Intent
        </label>
      </fieldset>
      <p className="mode-status">{sessionModeLabel(mode)}. {modeStatus(mode)}</p>
      {shellError === "" ? null : <p className="note">{shellError}</p>}
      <div
        className="terminal-host"
        ref={hostRef}
        inert={mode === "shell" ? undefined : true}
      />
      <form
        className="intent"
        inert={mode === "intent" ? undefined : true}
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "intent") {
            onSubmitIntent();
          }
        }}
      >
        <label htmlFor="intent-draft">Intent</label>
        <textarea
          id="intent-draft"
          value={draft}
          disabled={mode !== "intent"}
          spellCheck={false}
          onChange={(event) => {
            onDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (mode !== "intent") {
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              onSubmitIntent();
            }
          }}
        />
        <p className="note">Enter submits. Shift+Enter inserts a line break.</p>
        {plannerNotice === "" ? null : (
          <p className="note" role="status">
            {plannerNotice}
          </p>
        )}
      </form>
    </section>
  );
}

function modeStatus(mode: SessionMode): string {
  switch (mode) {
    case "shell":
      return "Keys go to the shell.";
    case "intent":
      return "Enter stays in the intent draft.";
    default: {
      const unreachable: never = mode;
      throw new Error(`unhandled mode ${String(unreachable)}`);
    }
  }
}

function fitTerminal(fit: FitAddon): void {
  try {
    fit.fit();
  } catch {
    // The host can report a zero size before layout. The next resize retries.
  }
}

async function waitForSize(
  terminal: Terminal,
  fit: FitAddon,
): Promise<{ rows: number; cols: number }> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    fitTerminal(fit);
    if (terminal.cols > 0 && terminal.rows > 0) {
      return { rows: terminal.rows, cols: terminal.cols };
    }
    await nextFrame();
  }
  return { rows: 24, cols: 80 };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function asBytes(payload: unknown): Uint8Array | null {
  if (!Array.isArray(payload)) {
    return null;
  }
  const bytes = new Uint8Array(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    const value = payload[index];
    if (typeof value !== "number") {
      return null;
    }
    bytes[index] = value;
  }
  return bytes;
}

function errorText(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "The shell could not be started.";
}
