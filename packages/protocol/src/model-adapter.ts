import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { DISPATCH_SCHEMA_VERSION, KNOWN_TOOL_VERSION } from "./dispatch.ts";
import type { DispatchEnvelope } from "./dispatch.ts";
import { MISSION_SCHEMA_VERSION } from "./mission.ts";
import {
  hasExactKeys,
  isRecord,
  nonEmptyString,
  schemaVersion,
  stringArray,
} from "./values.ts";

export const PROVIDER = "openai" as const;
export const ACCEPTED_TERMS = "OpenAI Services Agreement" as const;
export const ACCEPTED_FIXTURE = "fixtures/failing-add" as const;
export const PINNED_MODEL = "gpt-5-2025-08-07" as const;

// Standard list prices for the pinned gpt-5 snapshot.
// https://developers.openai.com/api/docs/models/gpt-5
// Input $1.25 / 1M, cached input $0.125 / 1M, output $10 / 1M.
const INPUT_NANO_USD_PER_TOKEN = 1250n;
const CACHED_INPUT_NANO_USD_PER_TOKEN = 125n;
const OUTPUT_NANO_USD_PER_TOKEN = 10000n;
const NANO_USD = 1_000_000_000n;
const FILE_BYTE_LIMIT = 16_384;
const LEASE_MS = 60_000;
const MAX_OUTPUT_TOKENS = 512;
const PROVIDER_URL = "https://api.openai.com/v1/responses";
const RESPONSE_BODY_LIMIT = 1_000_000;

const FIXTURE_FILES = [
  "fixtures/failing-add/add.py",
  "fixtures/failing-add/test_add.py",
] as const;

export type AllowedFixturePath = (typeof FIXTURE_FILES)[number];

export type SentFile = {
  path: AllowedFixturePath;
  sha256: string;
};

export type CostEstimate = {
  label: "estimate";
  currency: "USD";
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  amount_usd: string;
};

export type ModelPlanFailure =
  | "invalid_request"
  | "unknown_schema_version"
  | "unknown_tool_version"
  | "files_not_allowed"
  | "fixture_unavailable"
  | "provider_unconfigured"
  | "provider_error"
  | "model_mismatch"
  | "usage_missing"
  | "plan_rejected";

type ModelPlanBase = {
  provider: typeof PROVIDER;
  terms: typeof ACCEPTED_TERMS;
  fixture: typeof ACCEPTED_FIXTURE;
  model: typeof PINNED_MODEL;
  files_sent: SentFile[];
  provider_contacted: boolean;
};

export type ModelPlan =
  | (ModelPlanBase & {
      ok: true;
      plan: DispatchEnvelope;
      cost: CostEstimate;
      provider_contacted: true;
    })
  | (ModelPlanBase & {
      ok: false;
      reason: ModelPlanFailure;
      cost?: CostEstimate;
    });

export type ProviderExchange = {
  model: typeof PINNED_MODEL;
  bodyText: string;
};

export type ProviderResponse = {
  status: number;
  bodyText: string;
};

export type ProviderTransport = (
  exchange: ProviderExchange,
) => Promise<ProviderResponse>;

export type PlanOptions = {
  transport?: ProviderTransport;
  now?: () => Date;
  readKey?: () => string | undefined;
};

type PreparedFile = SentFile & { text: string };

type ToolAction =
  | { action: "test" }
  | { action: "read"; path: AllowedFixturePath };

// The adapter calls one pinned model and emits one dispatch envelope for the
// fixture tool. It does not run that tool. A model sentence is not a grant.
export async function planFailingAdd(
  request: unknown,
  serverTenantId: string,
  repoRoot: string,
  options: PlanOptions = {},
): Promise<ModelPlan> {
  const tenantId = nonEmptyString(serverTenantId);
  if (tenantId === undefined || !isRecord(request)) {
    return failure("invalid_request", [], false);
  }
  const version = versionFailure(request);
  if (version !== undefined) {
    return failure(version, [], false);
  }
  const selected = filesToSend(request);
  if (selected === undefined) {
    return failure("files_not_allowed", [], false);
  }
  const prepared = readFixtureFiles(repoRoot, selected);
  if (prepared === undefined) {
    return failure("fixture_unavailable", [], false);
  }

  const transport = options.transport ?? configuredTransport(options.readKey);
  if (transport === undefined) {
    return failure("provider_unconfigured", [], false);
  }

  const sent = prepared.map(sentFile);
  const exchange = providerExchange(prepared);
  let response: ProviderResponse;
  try {
    response = await transport(exchange);
  } catch {
    return failure("provider_error", sent, true);
  }
  return interpretResponse(response, sent, tenantId, options.now ?? (() => new Date()));
}

function failure(
  reason: ModelPlanFailure,
  filesSent: SentFile[],
  providerContacted: boolean,
  cost?: CostEstimate,
): ModelPlan {
  const result = {
    ok: false as const,
    reason,
    provider: PROVIDER,
    terms: ACCEPTED_TERMS,
    fixture: ACCEPTED_FIXTURE,
    model: PINNED_MODEL,
    files_sent: filesSent,
    provider_contacted: providerContacted,
  };
  if (cost === undefined) {
    return result;
  }
  return { ...result, cost };
}

function configuredTransport(
  readKey: PlanOptions["readKey"],
): ProviderTransport | undefined {
  const key = configuredKey((readKey ?? defaultReadKey)());
  if (key === undefined) {
    return undefined;
  }
  return (exchange) => openAiTransport(exchange, key);
}

function configuredKey(value: string | undefined): string | undefined {
  const key = nonEmptyString(value);
  if (key === undefined || !key.startsWith("sk-") || /\s/u.test(key)) {
    return undefined;
  }
  return key;
}

function defaultReadKey(): string | undefined {
  return process.env.OPENAI_API_KEY;
}

async function openAiTransport(
  exchange: ProviderExchange,
  key: string,
): Promise<ProviderResponse> {
  const response = await fetch(PROVIDER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: exchange.bodyText,
    signal: AbortSignal.timeout(30_000),
  });
  const bodyText = await response.text();
  return { status: response.status, bodyText };
}

function providerExchange(files: readonly PreparedFile[]): ProviderExchange {
  const body = {
    model: PINNED_MODEL,
    store: false,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    reasoning: { effort: "minimal" },
    instructions: instructions(files.map((file) => file.path)),
    input: files.map((file) => `FILE ${file.path}\n${file.text}`).join("\n"),
    text: { format: { type: "json_object" } },
  };
  return { model: PINNED_MODEL, bodyText: JSON.stringify(body) };
}

function instructions(paths: readonly AllowedFixturePath[]): string {
  const choices = ['{"action":"test"}'];
  for (const filePath of paths) {
    choices.push(`{"action":"read","path":"${filePath}"}`);
  }
  return [
    "Reply with one JSON object and no other text.",
    "The only tool is fixture version 0.1.",
    "Choose one of these actions:",
    ...choices,
    "Do not propose a patch, a shell command, or any other path.",
  ].join("\n");
}

function interpretResponse(
  response: ProviderResponse,
  sent: SentFile[],
  tenantId: string,
  now: () => Date,
): ModelPlan {
  if (response.status !== 200 || response.bodyText.length > RESPONSE_BODY_LIMIT) {
    return failure("provider_error", sent, true);
  }
  let body: unknown;
  try {
    body = JSON.parse(response.bodyText);
  } catch {
    return failure("provider_error", sent, true);
  }
  if (!isRecord(body)) {
    return failure("provider_error", sent, true);
  }
  const cost = usageCost(body.usage);
  if (body.model !== PINNED_MODEL) {
    return failure("model_mismatch", sent, true, cost);
  }
  if (body.status !== "completed") {
    return failure("provider_error", sent, true, cost);
  }
  if (cost === undefined) {
    return failure("usage_missing", sent, true);
  }
  const action = parseAction(outputText(body.output), sent);
  if (action === undefined) {
    return failure("plan_rejected", sent, true, cost);
  }
  const issuedAt = now();
  if (Number.isNaN(issuedAt.getTime())) {
    return failure("provider_error", sent, true, cost);
  }
  return {
    ok: true,
    provider: PROVIDER,
    terms: ACCEPTED_TERMS,
    fixture: ACCEPTED_FIXTURE,
    model: PINNED_MODEL,
    files_sent: sent,
    provider_contacted: true,
    cost,
    plan: stampPlan(tenantId, sent, action, issuedAt),
  };
}

function stampPlan(
  tenantId: string,
  sent: readonly SentFile[],
  action: ToolAction,
  issuedAt: Date,
): DispatchEnvelope {
  const requestDigest = digest(
    [
      PINNED_MODEL,
      ...sent.map((file) => `${file.path} ${file.sha256}`),
    ].join("\n"),
  );
  return {
    schema_version: DISPATCH_SCHEMA_VERSION,
    tenant_id: tenantId,
    mission_id: "failing-add",
    run_id: requestDigest,
    operation_id: digest(`${requestDigest}\n${actionText(action)}`),
    fencing_token: "1",
    tool_id: "fixture",
    tool_version: KNOWN_TOOL_VERSION,
    arguments: actionArguments(action),
    scope: ACCEPTED_FIXTURE,
    location: "device",
    grant_id: "adapter-plan",
    policy_version: "0.1",
    issued_at: isoUtc(issuedAt),
    expires_at: isoUtc(new Date(issuedAt.getTime() + LEASE_MS)),
    request_digest: requestDigest,
    budget_reservation_id: "adapter-estimate",
    trace_id: requestDigest,
  };
}

function actionText(action: ToolAction): string {
  switch (action.action) {
    case "test":
      return "test";
    case "read":
      return `read ${action.path}`;
    default: {
      const unexpected: never = action;
      return unexpected;
    }
  }
}

function actionArguments(action: ToolAction): Record<string, unknown> {
  switch (action.action) {
    case "test":
      return { action: "test" };
    case "read":
      return { action: "read", path: action.path };
    default: {
      const unexpected: never = action;
      return unexpected;
    }
  }
}

function outputText(output: unknown): unknown {
  if (!Array.isArray(output)) {
    return undefined;
  }
  const texts: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) {
      return undefined;
    }
    switch (item.type) {
      case "reasoning":
        continue;
      case "message": {
        const text = messageText(item.content);
        if (text === undefined) {
          return undefined;
        }
        texts.push(text);
        continue;
      }
      default:
        return undefined;
    }
  }
  if (texts.length !== 1) {
    return undefined;
  }
  try {
    return JSON.parse(texts[0]);
  } catch {
    return undefined;
  }
}

function messageText(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const texts: string[] = [];
  for (const part of content) {
    if (!isRecord(part) || part.type !== "output_text" || typeof part.text !== "string") {
      return undefined;
    }
    texts.push(part.text);
  }
  if (texts.length !== 1) {
    return undefined;
  }
  return texts[0];
}

function parseAction(value: unknown, sent: readonly SentFile[]): ToolAction | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  switch (value.action) {
    case "test":
      if (!hasExactKeys(value, ["action"])) {
        return undefined;
      }
      return { action: "test" };
    case "read": {
      if (!hasExactKeys(value, ["action", "path"]) || typeof value.path !== "string") {
        return undefined;
      }
      const filePath = allowedPath(value.path);
      if (filePath === undefined || !sent.some((file) => file.path === filePath)) {
        return undefined;
      }
      return { action: "read", path: filePath };
    }
    default:
      return undefined;
  }
}

function usageCost(usage: unknown): CostEstimate | undefined {
  if (!isRecord(usage)) {
    return undefined;
  }
  const input = tokenCount(usage.input_tokens);
  const output = tokenCount(usage.output_tokens);
  if (input === undefined || output === undefined) {
    return undefined;
  }
  const cached = cachedTokens(usage.input_tokens_details, input);
  if (cached === undefined) {
    return undefined;
  }
  const uncached = BigInt(input - cached);
  const nano =
    uncached * INPUT_NANO_USD_PER_TOKEN +
    BigInt(cached) * CACHED_INPUT_NANO_USD_PER_TOKEN +
    BigInt(output) * OUTPUT_NANO_USD_PER_TOKEN;
  return {
    label: "estimate",
    currency: "USD",
    input_tokens: input,
    cached_input_tokens: cached,
    output_tokens: output,
    amount_usd: formatNanoUsd(nano),
  };
}

function cachedTokens(details: unknown, input: number): number | undefined {
  if (details === undefined) {
    return 0;
  }
  if (!isRecord(details)) {
    return undefined;
  }
  if (!Object.hasOwn(details, "cached_tokens")) {
    return 0;
  }
  const cached = tokenCount(details.cached_tokens);
  if (cached === undefined || cached > input) {
    return undefined;
  }
  return cached;
}

function tokenCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function formatNanoUsd(nano: bigint): string {
  const whole = nano / NANO_USD;
  const fraction = nano % NANO_USD;
  if (fraction === 0n) {
    return whole.toString();
  }
  const digits = fraction.toString().padStart(9, "0").replace(/0+$/u, "");
  return `${whole.toString()}.${digits}`;
}

function filesToSend(request: Record<string, unknown>): readonly AllowedFixturePath[] | undefined {
  const manifests = listedManifests(request);
  if (manifests.length === 0) {
    return FIXTURE_FILES;
  }
  const selected = new Set<AllowedFixturePath>();
  for (const manifest of manifests) {
    const paths = stringArray(manifest, 1);
    if (paths === undefined) {
      return undefined;
    }
    for (const item of paths) {
      const allowed = allowedPath(item);
      if (allowed === undefined) {
        return undefined;
      }
      selected.add(allowed);
    }
  }
  return FIXTURE_FILES.filter((filePath) => selected.has(filePath));
}

function listedManifests(request: Record<string, unknown>): unknown[] {
  const manifests: unknown[] = [];
  if (Object.hasOwn(request, "input_manifest")) {
    manifests.push(request.input_manifest);
  }
  if (isRecord(request.mission) && Object.hasOwn(request.mission, "input_manifest")) {
    manifests.push(request.mission.input_manifest);
  }
  return manifests;
}

function allowedPath(value: string): AllowedFixturePath | undefined {
  for (const filePath of FIXTURE_FILES) {
    if (value === filePath) {
      return filePath;
    }
  }
  return undefined;
}

function readFixtureFiles(
  repoRoot: string,
  selected: readonly AllowedFixturePath[],
): PreparedFile[] | undefined {
  const files: PreparedFile[] = [];
  for (const relativePath of selected) {
    const prepared = readOneFile(repoRoot, relativePath);
    if (prepared === undefined) {
      return undefined;
    }
    files.push(prepared);
  }
  return files;
}

function readOneFile(repoRoot: string, relativePath: AllowedFixturePath): PreparedFile | undefined {
  const root = path.resolve(repoRoot);
  const target = path.resolve(root, relativePath);
  const fixtureRoot = path.resolve(root, ACCEPTED_FIXTURE);
  if (target !== path.join(fixtureRoot, path.basename(relativePath))) {
    return undefined;
  }
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return undefined;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > FILE_BYTE_LIMIT) {
    return undefined;
  }
  const bytes = readFileSync(target);
  if (bytes.includes(0)) {
    return undefined;
  }
  const text = bytes.toString("utf8");
  return { path: relativePath, sha256: digest(bytes), text };
}

function sentFile(file: PreparedFile): SentFile {
  return { path: file.path, sha256: file.sha256 };
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isoUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function versionFailure(
  request: Record<string, unknown>,
): "unknown_schema_version" | "unknown_tool_version" | undefined {
  if (unknownSchema(schemaVersion(request), [MISSION_SCHEMA_VERSION, DISPATCH_SCHEMA_VERSION])) {
    return "unknown_schema_version";
  }
  if (unknownTool(request)) {
    return "unknown_tool_version";
  }
  if (!isRecord(request.mission) && !isRecord(request.dispatch)) {
    return undefined;
  }
  if (unknownSchema(schemaVersion(request.mission), [MISSION_SCHEMA_VERSION])) {
    return "unknown_schema_version";
  }
  if (unknownSchema(schemaVersion(request.dispatch), [DISPATCH_SCHEMA_VERSION])) {
    return "unknown_schema_version";
  }
  if (isRecord(request.dispatch) && unknownTool(request.dispatch)) {
    return "unknown_tool_version";
  }
  return undefined;
}

function unknownSchema(version: string | undefined, known: readonly string[]): boolean {
  return version !== undefined && !known.includes(version);
}

function unknownTool(value: Record<string, unknown>): boolean {
  return Object.hasOwn(value, "tool_version") && value.tool_version !== KNOWN_TOOL_VERSION;
}
