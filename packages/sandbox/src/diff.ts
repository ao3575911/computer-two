import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runFixtureUnittest } from "./tool.ts";
import type { SandboxFailure } from "./bwrap.ts";

const FIXTURE = "fixtures/failing-add";
const FIXTURE_FILES = ["add.py", "test_add.py"] as const;
const WRONG_SUM = "return left + right + 1";
const CORRECT_SUM = "return left + right";

export type BaseFileRevision = {
  path: string;
  sha256: string;
};

export type BaseRevision = {
  fixture: typeof FIXTURE;
  files: BaseFileRevision[];
  digest: string;
};

export type FailingAddDiff =
  | {
      ok: true;
      base: BaseRevision;
      diff: string;
      applied: false;
      exitCode: number;
      rawLog: string;
    }
  | {
      ok: false;
      reason:
        | "edit_not_bounded"
        | "sandbox_unavailable"
        | "check_did_not_run"
        | "fixture_changed";
    };

export function captureBaseRevision(repoRoot: string): BaseRevision {
  const files = FIXTURE_FILES.map((name) => {
    const relativePath = `${FIXTURE}/${name}`;
    const bytes = readFileSync(path.join(repoRoot, relativePath));
    return { path: relativePath, sha256: sha256(bytes) };
  });
  const listing = files.map((file) => `${file.path} ${file.sha256}`).join("\n");
  return {
    fixture: FIXTURE,
    files,
    digest: sha256(`${listing}\n`),
  };
}

export function boundedSumEdit(source: string): string | undefined {
  const parts = source.split(WRONG_SUM);
  if (parts.length !== 2) {
    return undefined;
  }
  const edited = parts.join(CORRECT_SUM);
  if (edited === source || edited.includes(WRONG_SUM)) {
    return undefined;
  }
  return edited;
}

export function unifiedDiff(filePath: string, before: string, after: string): string {
  const beforeLines = textLines(before);
  const afterLines = textLines(after);
  const lines = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
  ];
  const count = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < count; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) {
      lines.push(` ${oldLine ?? ""}`);
      continue;
    }
    if (oldLine !== undefined) {
      lines.push(`-${oldLine}`);
    }
    if (newLine !== undefined) {
      lines.push(`+${newLine}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export async function proposeFailingAddDiff(
  repoRoot: string,
): Promise<FailingAddDiff> {
  const addPath = path.join(repoRoot, FIXTURE, "add.py");
  const testPath = path.join(repoRoot, FIXTURE, "test_add.py");
  const before = readFileSync(addPath, "utf8");
  const base = captureBaseRevision(repoRoot);
  const edited = boundedSumEdit(before);
  if (edited === undefined) {
    return { ok: false, reason: "edit_not_bounded" };
  }

  const directory = mkdtempSync(path.join(tmpdir(), "failing-add-edit-"));
  try {
    writeFileSync(path.join(directory, "add.py"), edited);
    writeFileSync(path.join(directory, "test_add.py"), readFileSync(testPath));
    const ran = await runFixtureUnittest({
      root: directory,
      files: ["add.py", "test_add.py"],
    });
    if (!ran.ok) {
      return { ok: false, reason: failureReason(ran.reason) };
    }
    if (readFileSync(addPath, "utf8") !== before) {
      return { ok: false, reason: "fixture_changed" };
    }
    return {
      ok: true,
      base,
      diff: unifiedDiff(`${FIXTURE}/add.py`, before, edited),
      applied: false,
      exitCode: ran.exitCode,
      rawLog: `${ran.stdout}${ran.stderr}`,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function failureReason(
  reason: SandboxFailure,
): "sandbox_unavailable" | "check_did_not_run" {
  switch (reason) {
    case "bubblewrap_missing":
      return "sandbox_unavailable";
    case "invalid_manifest":
    case "sandbox_error":
      return "check_did_not_run";
    default: {
      const unexpected: never = reason;
      return unexpected;
    }
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function textLines(value: string): string[] {
  if (value.length === 0) {
    return [];
  }
  const normalized = value.endsWith("\n") ? value.slice(0, -1) : value;
  return normalized.split("\n");
}
