# computer-two

C:2 Terminal is the Computer II desktop application. Slice 1 currently has the Linux desktop shell, a real local PTY, versioned protocol types, and a mock planner.

The repository license is undecided. Upstream components keep their own licenses. No project license file is included.

## Pinned stack

Pinned after a Linux build on x86_64, 2026-10-18. The recommended stack built. It was not replaced.

| Component | Pinned version | License | Role |
| --- | --- | --- | --- |
| Tauri | Rust crate `tauri` 2.12.3, `tauri-build` 2.7.2, `@tauri-apps/api` 2.12.4, `@tauri-apps/cli` 2.12.3 | Apache-2.0 OR MIT | Desktop shell |
| Rust | 1.99.1 (`rust-toolchain.toml`) | MIT OR Apache-2.0 | Native toolchain. Tauri 2.12 states a minimum of Rust 1.90. This spike compiled with 1.99.1 only. |
| TypeScript | 6.0.3 | Apache-2.0 | Frontend types. create-tauri-app 4.7.5 targets the TypeScript 6.0 line. TypeScript 7.0.2 is published and was not required for this window. |
| React | 19.3.1 (`react-dom` 19.3.1) | MIT | First screen |
| xterm.js | `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0 | MIT | Shell display and resize |
| Vite | 8.3.4, `@vitejs/plugin-react` 6.1.2 | MIT | Frontend build |
| GTK Rust bindings | `gtk` 0.18.2, `atk` 0.18.2 | MIT | Set the Linux window accessible name |
| PTY | `portable-pty` 0.9.0 | MIT | Local shell session |

The Linux binary links the system WebKitGTK and GTK libraries. Their Debian copyright files list more than one license, including LGPL-2+ for both and LGPL-2.1+ for GTK. Those libraries stay on the host; this repository does not vendor them. Rust itself is MIT OR Apache-2.0.

Node used for this spike: 22.23.3, npm 10.9.9.

Linux packages used to compile the webview: `libwebkit2gtk-4.1-dev` 2.52.6, `libgtk-3-dev` 3.24.41, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`, `libssl-dev`, `libxdo-dev`, `pkg-config`, and `build-essential`.

`package-lock.json` and `src-tauri/Cargo.lock` pin the resolved dependency trees.

## Build and launch

From a Linux host with the packages above and Rust 1.99.1:

```sh
cd apps/terminal
npm ci
npm run tauri build -- --debug --no-bundle
./src-tauri/target/debug/computer-two
```

The window title is `C:2 Terminal`. The accessible name is `Computer Two`. The visible wordmark is `Computer II`. Build `0.1.0` is shown on the first screen.

Tauri rejects `:` in `productName` (`^[^/\\:*?\"<>|]+$`). The bundle name is therefore `Computer Two`, which is the spoken name. The window title stays `C:2 Terminal`.

`Open shell` starts a local shell in shell mode. `Open folder` and `Start sample mission` stay disabled. Shell and intent are separate. The mode changes only through the Mode control. Intent submit shows that no planner is connected and does not write to the PTY. There is no model call.

## Limitations

- Open folder and Start sample mission do not run.
- There is no broker, sandbox, model adapter, cloud control plane, or OS image. `packages/protocol` has the starter schemas, the dispatch envelope, a mock mission reducer, and a mock planner. The planner emits one fixed dispatch envelope. It is not connected to the terminal window. It does not call a model, and it does not execute a tool.
- The blueprint simulator is not included.
- Content-Security-Policy allows same-origin scripts. Styles allow same-origin files and inline style rules, because xterm.js sets cell color, font, and size that way. The text is the page color on the terminal background when those rules are blocked. The verified launch path is the bundled debug binary above. `npm run tauri dev` was not the command used for this check. Vite's React preamble is an inline script, so that command may not render under this policy.
- App icons are the unmodified create-tauri-app placeholders. They are not Computer II brand assets.
- Repository license, domains, and trademark jurisdictions are undecided.
- A release build (`npm run tauri build` without `--debug`) was not run. The verified build is the debug binary.

## Step 1 window

The parent branch opened a window on `DISPLAY=:1`. Its title was `C:2 Terminal` and its AT-SPI frame name was `Computer Two`. That check used a build where all three actions were disabled.

## Step 2 host check

Checked on this Linux host with `DISPLAY=:1` from the debug binary. `Open shell` entered shell mode. The prompt was visible after inline terminal styles were allowed.

- Resize: the PTY followed the window. `stty size` reported `20 107`, then `13 86` after the window was made smaller.
- Signals: Ctrl+C while `sleep 30` was the foreground process printed `^C`. The next command, `echo $?`, printed `130`. The session stayed in shell mode.
- TUI: `vim -Nu NONE -n` (vim 9.1.697) drew its full-screen intro, and `:q` returned to the prompt. `less` is not installed on this host.
- Unicode: a `printf` of UTF-8 bytes printed `café 你好`, and those glyphs were visible. Typing `café-typed` into the shell echoed that text. The terminal font stack is DejaVu Sans Mono, then WenQuanYi Micro Hei Mono.
- IME: not verified. This host has no ibus, fcitx, or fcitx5 process, and `GTK_IM_MODULE`, `QT_IM_MODULE`, and `XMODIFIERS` are unset, so there is no input-method composition session to exercise.

Intent was checked with the Mode control. Shift+Enter inserted a line break in the draft. Enter showed "No planner is connected." and did not send the draft to the PTY. Switching back to Shell with the Mode control sent a later command to the shell.

The window title was `C:2 Terminal`. The AT-SPI frame name was `Computer Two`. The application object name was `computer-two`.

## Protocol

`packages/protocol` keeps the starter mission and event schemas at version 0.1. The dispatch envelope is schema version 0.2 and adds only the fields named for that envelope. Unknown schema or tool versions fail closed. A caller-supplied tenant id is ignored; the reducer records the server tenant. The mock planner emits that same envelope as one fixed plan and does not vary it from the request.

```sh
cd packages/protocol
npm ci
npm test
```
