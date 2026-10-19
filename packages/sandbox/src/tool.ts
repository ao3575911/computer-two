import { runSlice1Sandbox } from "./bwrap.ts";
import type { FixtureManifest, SandboxFailure, SandboxRun } from "./bwrap.ts";

const READ_SCRIPT = [
  "import pathlib, sys",
  "target = pathlib.Path('/workspace') / sys.argv[1]",
  "sys.stdout.buffer.write(target.read_bytes())",
].join("\n");

export const UNITTEST_COMMAND = ["python3", "-m", "unittest"] as const;

export type ReadResult =
  | { ok: true; text: string }
  | { ok: false; reason: "not_in_manifest" | SandboxFailure };

export async function readManifestFile(
  manifest: FixtureManifest,
  relativePath: string,
): Promise<ReadResult> {
  if (!manifest.files.includes(relativePath)) {
    return { ok: false, reason: "not_in_manifest" };
  }
  const ran = await runSlice1Sandbox(manifest, [
    "python3",
    "-c",
    READ_SCRIPT,
    "--",
    relativePath,
  ]);
  if (!ran.ok) {
    return ran;
  }
  if (ran.exitCode !== 0) {
    return { ok: false, reason: "sandbox_error" };
  }
  return { ok: true, text: ran.stdout };
}

export async function runFixtureUnittest(
  manifest: FixtureManifest,
): Promise<SandboxRun> {
  return runSlice1Sandbox(manifest, UNITTEST_COMMAND);
}
