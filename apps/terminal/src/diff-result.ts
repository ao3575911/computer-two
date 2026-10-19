export type ShownDiff = {
  digest: string;
  resultSha256: string;
  diff: string;
  exitCode: number;
  rawLog: string;
  applied: false;
};

export function parseDiffResult(body: string): ShownDiff | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    value.ok !== true ||
    value.applied !== false ||
    typeof value.diff !== "string" ||
    typeof value.resultSha256 !== "string" ||
    typeof value.exitCode !== "number" ||
    typeof value.rawLog !== "string" ||
    !isRecord(value.base) ||
    typeof value.base.digest !== "string" ||
    !isSha256(value.resultSha256) ||
    !isSha256(value.base.digest)
  ) {
    return undefined;
  }
  return {
    digest: value.base.digest,
    resultSha256: value.resultSha256,
    diff: value.diff,
    exitCode: value.exitCode,
    rawLog: value.rawLog,
    applied: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}
