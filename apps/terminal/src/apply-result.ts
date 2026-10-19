export type ShownReview = {
  digest: string;
  resultSha256: string;
  diff: string;
  exitCode: number;
  rawLog: string;
};

export type ShownApply =
  | { status: "applied"; digest: string; resultSha256: string }
  | { status: "conflict"; newerSha256: string; review?: ShownReview }
  | { status: "cancelled" }
  | { status: "reconciling" };

export function parseApplyResult(body: string): ShownApply | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || value.ok !== true || typeof value.status !== "string") {
    return undefined;
  }
  switch (value.status) {
    case "applied":
      if (!isSha256(value.baseDigest) || !isSha256(value.resultSha256)) {
        return undefined;
      }
      return {
        status: "applied",
        digest: value.baseDigest,
        resultSha256: value.resultSha256,
      };
    case "conflict":
      if (!isSha256(value.newerSha256)) {
        return undefined;
      }
      return {
        status: "conflict",
        newerSha256: value.newerSha256,
        review: parseReview(value.review),
      };
    case "cancelled":
      return { status: "cancelled" };
    case "reconciling":
      return { status: "reconciling" };
    default:
      return undefined;
  }
}

function parseReview(value: unknown): ShownReview | undefined {
  if (!isRecord(value) || value.ok !== true || value.applied !== false) {
    return undefined;
  }
  if (
    !isSha256(value.baseDigest) ||
    !isSha256(value.resultSha256) ||
    typeof value.diff !== "string" ||
    typeof value.exitCode !== "number" ||
    typeof value.rawLog !== "string"
  ) {
    return undefined;
  }
  return {
    digest: value.baseDigest,
    resultSha256: value.resultSha256,
    diff: value.diff,
    exitCode: value.exitCode,
    rawLog: value.rawLog,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
