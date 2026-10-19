export type ShownDiff = {
  digest: string;
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
    typeof value.exitCode !== "number" ||
    typeof value.rawLog !== "string" ||
    !isRecord(value.base) ||
    typeof value.base.digest !== "string"
  ) {
    return undefined;
  }
  return {
    digest: value.base.digest,
    diff: value.diff,
    exitCode: value.exitCode,
    rawLog: value.rawLog,
    applied: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
