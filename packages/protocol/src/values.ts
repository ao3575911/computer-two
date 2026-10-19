export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1) {
    return undefined;
  }
  return value;
}

export function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  if (actual.length !== keys.length) {
    return false;
  }
  return keys.every((key) => Object.hasOwn(value, key));
}

export function nonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

export function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

export function stringArray(
  value: unknown,
  minimumItems: number,
): string[] | undefined {
  if (!Array.isArray(value) || value.length < minimumItems) {
    return undefined;
  }
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      return undefined;
    }
    items.push(item);
  }
  return items;
}

export function locationValue(value: unknown): "device" | "cloud" | undefined {
  switch (value) {
    case "device":
    case "cloud":
      return value;
    default:
      return undefined;
  }
}

export function schemaVersion(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const version = value.schema_version;
  if (typeof version !== "string") {
    return undefined;
  }
  return version;
}
