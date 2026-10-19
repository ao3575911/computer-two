import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";

/** Slice 1 mount and network confinement. Not a production-grade boundary. */
export const SLICE1_SANDBOX_LABEL =
  "slice 1 sandbox, not a production-grade boundary";

export const BUBBLEWRAP_BIN = "/usr/bin/bwrap";
export const GUEST_WORKSPACE = "/workspace";

const OUTPUT_LIMIT = 1_000_000;
const TIMEOUT_MS = 20_000;

export type FixtureManifest = {
  root: string;
  files: readonly string[];
};

export type ResolvedManifestFile = {
  relativePath: string;
  hostPath: string;
  guestPath: string;
};

export type SandboxFailure =
  | "bubblewrap_missing"
  | "invalid_manifest"
  | "sandbox_error";

export type SandboxRun =
  | {
      ok: true;
      exitCode: number;
      stdout: string;
      stderr: string;
      argv: readonly string[];
    }
  | { ok: false; reason: SandboxFailure };

type ResolvedManifest =
  | { ok: true; files: ResolvedManifestFile[] }
  | { ok: false; reason: "invalid_manifest" };

type Spawned =
  | { ok: true; exitCode: number; stdout: string; stderr: string }
  | { ok: false; reason: "sandbox_error" };

function isManifestRelativePath(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

export function bubblewrapVersion(): string | undefined {
  if (!existsSync(BUBBLEWRAP_BIN)) {
    return undefined;
  }
  const result = spawnSync(BUBBLEWRAP_BIN, ["--version"], { encoding: "utf8" });
  if (result.status !== 0) {
    return undefined;
  }
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return text.length > 0 ? text : undefined;
}

export function resolveFixtureManifest(manifest: FixtureManifest): ResolvedManifest {
  if (!path.isAbsolute(manifest.root) || manifest.files.length === 0) {
    return { ok: false, reason: "invalid_manifest" };
  }
  let rootStat;
  try {
    rootStat = lstatSync(manifest.root);
  } catch {
    return { ok: false, reason: "invalid_manifest" };
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return { ok: false, reason: "invalid_manifest" };
  }
  let root: string;
  try {
    root = realpathSync(manifest.root);
  } catch {
    return { ok: false, reason: "invalid_manifest" };
  }

  const files: ResolvedManifestFile[] = [];
  const seen = new Set<string>();
  for (const relativePath of manifest.files) {
    if (!isManifestRelativePath(relativePath) || seen.has(relativePath)) {
      return { ok: false, reason: "invalid_manifest" };
    }
    seen.add(relativePath);
    const hostPath = path.join(root, relativePath);
    let fileStat;
    try {
      fileStat = lstatSync(hostPath);
    } catch {
      return { ok: false, reason: "invalid_manifest" };
    }
    // lstat rejects a symlink before the bind. This is not a TOCTOU defense.
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      return { ok: false, reason: "invalid_manifest" };
    }
    let canonical: string;
    try {
      canonical = realpathSync(hostPath);
    } catch {
      return { ok: false, reason: "invalid_manifest" };
    }
    if (canonical !== hostPath || !canonical.startsWith(`${root}${path.sep}`)) {
      return { ok: false, reason: "invalid_manifest" };
    }
    files.push({
      relativePath,
      hostPath: canonical,
      guestPath: `${GUEST_WORKSPACE}/${relativePath}`,
    });
  }
  return { ok: true, files };
}

export function slice1SandboxArgv(
  files: readonly ResolvedManifestFile[],
  command: readonly string[],
): string[] {
  const argv = [
    BUBBLEWRAP_BIN,
    "--unshare-all",
    "--unshare-net",
    "--die-with-parent",
    "--new-session",
    "--clearenv",
    "--setenv",
    "PATH",
    "/usr/bin",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--setenv",
    "PYTHONDONTWRITEBYTECODE",
    "1",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/lib",
    "/lib",
    "--ro-bind",
    "/lib64",
    "/lib64",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    "--dev",
    "/dev",
    "--dir",
    GUEST_WORKSPACE,
  ];
  for (const file of files) {
    argv.push("--ro-bind", file.hostPath, file.guestPath);
  }
  argv.push("--chdir", GUEST_WORKSPACE, ...command);
  return argv;
}

function spawnBwrap(argv: readonly string[]): Promise<Spawned> {
  return new Promise((resolve) => {
    const child = spawn(argv[0] ?? BUBBLEWRAP_BIN, argv.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    function finish(result: Spawned): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    function take(chunk: Buffer, sink: Buffer[]): void {
      bytes += chunk.length;
      if (bytes > OUTPUT_LIMIT) {
        child.kill("SIGKILL");
        finish({ ok: false, reason: "sandbox_error" });
        return;
      }
      sink.push(chunk);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      take(chunk, stdout);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      take(chunk, stderr);
    });
    child.on("error", () => {
      finish({ ok: false, reason: "sandbox_error" });
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, reason: "sandbox_error" });
    }, TIMEOUT_MS);
    child.on("close", (code) => {
      if (code === null) {
        finish({ ok: false, reason: "sandbox_error" });
        return;
      }
      finish({
        ok: true,
        exitCode: code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

export async function runSlice1Sandbox(
  manifest: FixtureManifest,
  command: readonly string[],
): Promise<SandboxRun> {
  if (!existsSync(BUBBLEWRAP_BIN)) {
    return { ok: false, reason: "bubblewrap_missing" };
  }
  if (
    command.length === 0 ||
    command.some((arg) => arg.length === 0 || arg.includes("\0"))
  ) {
    return { ok: false, reason: "sandbox_error" };
  }
  const resolved = resolveFixtureManifest(manifest);
  if (!resolved.ok) {
    return resolved;
  }
  const argv = slice1SandboxArgv(resolved.files, command);
  const ran = await spawnBwrap(argv);
  if (!ran.ok) {
    return ran;
  }
  return { ...ran, argv };
}
