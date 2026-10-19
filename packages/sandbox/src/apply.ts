import { createHash } from "node:crypto";
import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { boundedSumEdit, captureBaseRevision, proposeFailingAddDiff } from "./diff.ts";
import type { FailingAddDiff } from "./diff.ts";

const ADD_PATH = "fixtures/failing-add/add.py" as const;

export type DispatchGate = {
  stop(): void;
  isStopped(): boolean;
};

export function createDispatchGate(): DispatchGate {
  let stopped = false;
  return {
    stop() {
      stopped = true;
    },
    isStopped() {
      return stopped;
    },
  };
}

// Stop blocks a new local dispatch before the operation starts.
export function beginLocalDispatch(
  gate: DispatchGate,
): { ok: true } | { ok: false; status: "cancelled" } {
  if (gate.isStopped()) {
    return { ok: false, status: "cancelled" };
  }
  return { ok: true };
}

export type ConflictReview =
  | {
      ok: true;
      baseDigest: string;
      resultSha256: string;
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

export type ApplyResult =
  | {
      ok: true;
      status: "applied";
      baseDigest: string;
      resultSha256: string;
    }
  | {
      ok: true;
      status: "conflict";
      path: typeof ADD_PATH;
      newerSha256: string;
      review?: ConflictReview;
    }
  | { ok: true; status: "cancelled" }
  | { ok: true; status: "reconciling" }
  | { ok: false; reason: "invalid_review" | "review_mismatch" | "apply_failed" };

export type ApplyHooks = {
  beforeWrite?: () => void;
  readAfterWrite?: () => string;
};

export async function applyReviewedPatch(
  repoRoot: string,
  review: { baseDigest: string; resultSha256: string },
  gate: DispatchGate,
  hooks?: ApplyHooks,
): Promise<ApplyResult> {
  const admission = beginLocalDispatch(gate);
  if (!admission.ok) {
    return { ok: true, status: "cancelled" };
  }
  if (!isSha256(review.baseDigest) || !isSha256(review.resultSha256)) {
    return { ok: false, reason: "invalid_review" };
  }

  const addPath = path.join(repoRoot, ADD_PATH);
  let before: string;
  try {
    before = readFileSync(addPath, "utf8");
  } catch {
    return { ok: false, reason: "apply_failed" };
  }
  let base;
  try {
    base = captureBaseRevision(repoRoot);
  } catch {
    return { ok: false, reason: "apply_failed" };
  }
  if (base.digest !== review.baseDigest) {
    return conflictResult(repoRoot, addPath, gate);
  }

  const edited = boundedSumEdit(before);
  if (edited === undefined || sha256(edited) !== review.resultSha256) {
    return { ok: false, reason: "review_mismatch" };
  }
  if (gate.isStopped()) {
    return { ok: true, status: "cancelled" };
  }
  hooks?.beforeWrite?.();
  if (gate.isStopped()) {
    return { ok: true, status: "cancelled" };
  }

  let immediate: Buffer;
  try {
    immediate = readFileSync(addPath);
  } catch {
    return { ok: false, reason: "apply_failed" };
  }
  if (sha256(immediate) !== sha256(before)) {
    return conflictResult(repoRoot, addPath, gate);
  }

  const temporary = path.join(
    path.dirname(addPath),
    `.${path.basename(addPath)}.${process.pid}.apply`,
  );
  let wrote = false;
  try {
    writeFileSync(temporary, edited, { flag: "wx" });
    renameSync(temporary, addPath);
    wrote = true;
    const observed = hooks?.readAfterWrite
      ? hooks.readAfterWrite()
      : readFileSync(addPath, "utf8");
    if (sha256(observed) !== review.resultSha256) {
      return { ok: true, status: "reconciling" };
    }
    return {
      ok: true,
      status: "applied",
      baseDigest: review.baseDigest,
      resultSha256: review.resultSha256,
    };
  } catch {
    if (!wrote) {
      try {
        unlinkSync(temporary);
      } catch {
        // The temporary file was not left behind.
      }
    }
    if (wrote) {
      return { ok: true, status: "reconciling" };
    }
    if (gate.isStopped()) {
      return { ok: true, status: "cancelled" };
    }
    return { ok: false, reason: "apply_failed" };
  }
}

async function conflictResult(
  repoRoot: string,
  addPath: string,
  gate: DispatchGate,
): Promise<ApplyResult> {
  let newer: Buffer;
  try {
    newer = readFileSync(addPath);
  } catch {
    return { ok: true, status: "reconciling" };
  }
  const newerSha256 = sha256(newer);
  if (gate.isStopped()) {
    return { ok: true, status: "conflict", path: ADD_PATH, newerSha256 };
  }

  let proposal: FailingAddDiff;
  try {
    proposal = await proposeFailingAddDiff(repoRoot);
  } catch {
    return { ok: true, status: "conflict", path: ADD_PATH, newerSha256 };
  }

  let after: Buffer;
  try {
    after = readFileSync(addPath);
  } catch {
    return { ok: true, status: "reconciling" };
  }
  if (!after.equals(newer)) {
    return {
      ok: true,
      status: "conflict",
      path: ADD_PATH,
      newerSha256: sha256(after),
    };
  }
  return {
    ok: true,
    status: "conflict",
    path: ADD_PATH,
    newerSha256,
    review: conflictReview(proposal),
  };
}

function conflictReview(proposal: FailingAddDiff): ConflictReview {
  if (!proposal.ok) {
    return { ok: false, reason: proposal.reason };
  }
  return {
    ok: true,
    baseDigest: proposal.base.digest,
    resultSha256: proposal.resultSha256,
    diff: proposal.diff,
    applied: false,
    exitCode: proposal.exitCode,
    rawLog: proposal.rawLog,
  };
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
