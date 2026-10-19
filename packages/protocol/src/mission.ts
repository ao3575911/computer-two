import {
  hasExactKeys,
  isRecord,
  locationValue,
  nonEmptyString,
  nonNegativeInteger,
  stringArray,
} from "./values.ts";

export const MISSION_SCHEMA_VERSION = "0.1";

export const MISSION_KEYS = [
  "schema_version",
  "mission_id",
  "objective",
  "location",
  "budget_units",
  "input_manifest",
  "success_checks",
] as const;

export type MissionLocation = "device" | "cloud";

export type MissionProposal = {
  schema_version: typeof MISSION_SCHEMA_VERSION;
  mission_id: string;
  objective: string;
  location: MissionLocation;
  budget_units: number;
  input_manifest: string[];
  success_checks: string[];
};

export function parseMission(value: unknown): MissionProposal | undefined {
  if (!isRecord(value) || !hasExactKeys(value, MISSION_KEYS)) {
    return undefined;
  }
  if (value.schema_version !== MISSION_SCHEMA_VERSION) {
    return undefined;
  }
  const missionId = nonEmptyString(value.mission_id);
  const objective = nonEmptyString(value.objective);
  const location = locationValue(value.location);
  const budgetUnits = nonNegativeInteger(value.budget_units);
  const inputManifest = stringArray(value.input_manifest, 0);
  const successChecks = stringArray(value.success_checks, 1);
  if (
    missionId === undefined ||
    objective === undefined ||
    location === undefined ||
    budgetUnits === undefined ||
    inputManifest === undefined ||
    successChecks === undefined
  ) {
    return undefined;
  }
  return {
    schema_version: MISSION_SCHEMA_VERSION,
    mission_id: missionId,
    objective,
    location,
    budget_units: budgetUnits,
    input_manifest: inputManifest,
    success_checks: successChecks,
  };
}
