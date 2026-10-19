import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DISPATCH_KEYS, DISPATCH_SCHEMA_VERSION } from "./dispatch.ts";
import { planFailingAdd, PINNED_MODEL } from "./model-adapter.ts";
import type { ProviderExchange, ProviderResponse } from "./model-adapter.ts";

const ADD_TEXT = "def add(left, right):\n    return left + right\n";
const TEST_TEXT = "import unittest\n\nfrom add import add\n";
const BAIT = "BAIT-CHECKOUT-SECRET";
const CALLER_TENANT = "caller-tenant-secret";
const SERVER_TENANT = "server-tenant-secret";
const OBJECTIVE = "CALLER-OBJECTIVE-SECRET";

function writeFixture(root: string): void {
  const directory = path.join(root, "fixtures", "failing-add");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "add.py"), ADD_TEXT);
  writeFileSync(path.join(directory, "test_add.py"), TEST_TEXT);
  writeFileSync(path.join(root, "bait.txt"), BAIT);
}

function providerResponse(
  text: string,
  usage: Record<string, unknown> | null = {
    input_tokens: 1000,
    output_tokens: 100,
  },
  model: string = PINNED_MODEL,
  status = "completed",
): ProviderResponse {
  const body: Record<string, unknown> = {
    model,
    status,
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text }],
      },
    ],
  };
  if (usage !== null) {
    body.usage = usage;
  }
  return { status: 200, bodyText: JSON.stringify(body) };
}

function capturingTransport(response: ProviderResponse): {
  transport: (exchange: ProviderExchange) => Promise<ProviderResponse>;
  bodies: string[];
} {
  const bodies: string[] = [];
  return {
    bodies,
    transport: (exchange) => {
      bodies.push(exchange.bodyText);
      return Promise.resolve(response);
    },
  };
}

test("the adapter sends only the accepted fixture and stamps the fixture tool", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "SECRETROOT-"));
  try {
    writeFixture(root);
    const captured = capturingTransport(providerResponse('{"action":"test"}'));
    const result = await planFailingAdd(
      {
        tenant_id: CALLER_TENANT,
        objective: OBJECTIVE,
        schema_version: "0.1",
        mission_id: "some-other-mission",
      },
      SERVER_TENANT,
      root,
      {
        transport: captured.transport,
        now: () => new Date("2026-10-19T03:00:00.000Z"),
        readKey: () => {
          throw new Error("should-not-be-read");
        },
      },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.equal(result.provider, "openai");
    assert.equal(result.terms, "OpenAI Services Agreement");
    assert.equal(result.fixture, "fixtures/failing-add");
    assert.equal(result.model, PINNED_MODEL);
    assert.equal(result.provider_contacted, true);
    assert.equal(result.cost.label, "estimate");
    assert.equal(result.cost.amount_usd, "0.00225");
    assert.deepEqual(
      result.files_sent.map((file) => file.path),
      ["fixtures/failing-add/add.py", "fixtures/failing-add/test_add.py"],
    );
    assert.deepEqual(Object.keys(result.plan).sort(), [...DISPATCH_KEYS].sort());
    assert.equal(result.plan.schema_version, DISPATCH_SCHEMA_VERSION);
    assert.equal(result.plan.tool_id, "fixture");
    assert.equal(result.plan.tool_version, "0.1");
    assert.equal(result.plan.tenant_id, SERVER_TENANT);
    assert.equal(result.plan.mission_id, "failing-add");
    assert.equal(result.plan.scope, "fixtures/failing-add");
    assert.equal(result.plan.location, "device");
    assert.deepEqual(result.plan.arguments, { action: "test" });
    assert.equal(result.plan.issued_at, "2026-10-19T03:00:00Z");
    assert.equal(result.plan.expires_at, "2026-10-19T03:01:00Z");
    assert.equal("tool_result" in result, false);
    assert.equal("tool_result" in result.plan, false);
    const body = captured.bodies[0] ?? "";
    assert.equal(JSON.parse(body).model, PINNED_MODEL);
    assert.equal(body.includes(BAIT), false);
    assert.equal(body.includes(CALLER_TENANT), false);
    assert.equal(body.includes(SERVER_TENANT), false);
    assert.equal(body.includes(OBJECTIVE), false);
    assert.equal(body.includes("SECRETROOT"), false);
    assert.equal(body.includes("should-not-be-read"), false);
    assert.equal(JSON.stringify(result).includes(CALLER_TENANT), false);
    assert.equal(JSON.stringify(result).includes("some-other-mission"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a manifest outside the accepted fixture is not sent", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fixture-"));
  let calls = 0;
  try {
    writeFixture(root);
    const result = await planFailingAdd(
      {
        mission: {
          schema_version: "0.1",
          input_manifest: ["src/checkout.ts", "fixtures/failing-add/add.py"],
        },
      },
      SERVER_TENANT,
      root,
      {
        transport: () => {
          calls += 1;
          return Promise.resolve(providerResponse('{"action":"test"}'));
        },
      },
    );
    assert.deepEqual(result, expectFailure("files_not_allowed"));
    assert.equal(calls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown schema version fails closed before the provider", async () => {
  const result = await planFailingAdd(
    { schema_version: "9.9", tool_version: "0.1" },
    SERVER_TENANT,
    "/unused",
    {
      transport: () => {
        throw new Error("provider was called");
      },
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.reason, "unknown_schema_version");
  assert.equal(result.provider_contacted, false);
  assert.deepEqual(result.files_sent, []);
  assert.equal("plan" in result, false);
});

test("an unknown tool version fails closed before the provider", async () => {
  const result = await planFailingAdd(
    {
      dispatch: { schema_version: DISPATCH_SCHEMA_VERSION, tool_version: "9.9" },
    },
    SERVER_TENANT,
    "/unused",
    {
      transport: () => {
        throw new Error("provider was called");
      },
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.reason, "unknown_tool_version");
  assert.equal(result.provider_contacted, false);
});

test("an action outside the fixture tool is not a plan", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fixture-"));
  try {
    writeFixture(root);
    const result = await planFailingAdd({}, SERVER_TENANT, root, {
      transport: () => Promise.resolve(providerResponse('{"action":"test","command":"sh"}')),
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.reason, "plan_rejected");
    assert.equal(result.provider_contacted, true);
    assert.equal(result.files_sent.length, 2);
    assert.equal(result.cost?.label, "estimate");
    assert.equal("plan" in result, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a different response model is not a plan", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fixture-"));
  try {
    writeFixture(root);
    const result = await planFailingAdd({}, SERVER_TENANT, root, {
      transport: () =>
        Promise.resolve(providerResponse('{"action":"test"}', null, "gpt-5")),
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.reason, "model_mismatch");
    assert.equal(JSON.stringify(result).includes("gpt-5\""), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing usage does not invent a cost", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fixture-"));
  try {
    writeFixture(root);
    const result = await planFailingAdd({}, SERVER_TENANT, root, {
      transport: () => Promise.resolve(providerResponse('{"action":"test"}', null)),
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.reason, "usage_missing");
    assert.equal(result.cost, undefined);
    assert.equal("plan" in result, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the cost is an estimate from the gpt-5 list price", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fixture-"));
  try {
    writeFixture(root);
    const inputOnly = await planFailingAdd({}, SERVER_TENANT, root, {
      transport: () =>
        Promise.resolve(
          providerResponse('{"action":"test"}', {
            input_tokens: 1_000_000,
            output_tokens: 0,
          }),
        ),
    });
    const cached = await planFailingAdd({}, SERVER_TENANT, root, {
      transport: () =>
        Promise.resolve(
          providerResponse('{"action":"test"}', {
            input_tokens: 1_000_000,
            output_tokens: 0,
            input_tokens_details: { cached_tokens: 1_000_000 },
          }),
        ),
    });
    const outputOnly = await planFailingAdd({}, SERVER_TENANT, root, {
      transport: () =>
        Promise.resolve(
          providerResponse('{"action":"test"}', {
            input_tokens: 1000,
            output_tokens: 0,
            input_tokens_details: { cached_tokens: 400 },
          }),
        ),
    });
    const millionOut = await planFailingAdd({}, SERVER_TENANT, root, {
      transport: () =>
        Promise.resolve(
          providerResponse('{"action":"test"}', {
            input_tokens: 0,
            output_tokens: 1_000_000,
          }),
        ),
    });
    assert.equal(inputOnly.ok && inputOnly.cost.amount_usd, "1.25");
    assert.equal(cached.ok && cached.cost.amount_usd, "0.125");
    assert.equal(outputOnly.ok && outputOnly.cost.amount_usd, "0.0008");
    assert.equal(outputOnly.ok && outputOnly.cost.cached_input_tokens, 400);
    assert.equal(millionOut.ok && millionOut.cost.amount_usd, "10");
    for (const result of [inputOnly, cached, outputOnly, millionOut]) {
      assert.equal(result.ok && result.cost.label, "estimate");
      assert.equal(result.ok && result.cost.currency, "USD");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a symlink in the fixture is not sent", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fixture-"));
  let calls = 0;
  try {
    writeFixture(root);
    const addPath = path.join(root, "fixtures", "failing-add", "add.py");
    unlinkSync(addPath);
    symlinkSync(path.join(root, "bait.txt"), addPath);
    const result = await planFailingAdd({}, SERVER_TENANT, root, {
      transport: () => {
        calls += 1;
        return Promise.resolve(providerResponse('{"action":"test"}'));
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.reason, "fixture_unavailable");
    assert.equal(result.provider_contacted, false);
    assert.equal(calls, 0);
    assert.equal(JSON.stringify(result).includes(BAIT), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a provider error is not copied into the result", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fixture-"));
  try {
    writeFixture(root);
    const result = await planFailingAdd({}, SERVER_TENANT, root, {
      transport: () =>
        Promise.resolve({
          status: 500,
          bodyText: "echoed-provider-body Authorization Bearer live-token",
        }),
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.reason, "provider_error");
    assert.equal(result.provider_contacted, true);
    assert.equal(result.files_sent.length, 2);
    const encoded = JSON.stringify(result);
    assert.equal(encoded.includes("echoed-provider-body"), false);
    assert.equal(encoded.includes("Bearer"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a value that is not an API key does not contact the provider", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fixture-"));
  try {
    writeFixture(root);
    const result = await planFailingAdd({}, SERVER_TENANT, root, {
      readKey: () => "not-a-provider-key",
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.reason, "provider_unconfigured");
    assert.equal(result.provider_contacted, false);
    assert.deepEqual(result.files_sent, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing API key does not contact the provider", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fixture-"));
  try {
    writeFixture(root);
    const result = await planFailingAdd({}, SERVER_TENANT, root, {
      readKey: () => undefined,
    });
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.equal(result.reason, "provider_unconfigured");
    assert.equal(result.provider_contacted, false);
    assert.deepEqual(result.files_sent, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a read action stays on a file that was sent", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "fixture-"));
  try {
    writeFixture(root);
    const captured = capturingTransport(
      providerResponse('{"action":"read","path":"fixtures/failing-add/add.py"}'),
    );
    const result = await planFailingAdd(
      { input_manifest: ["fixtures/failing-add/test_add.py", "fixtures/failing-add/add.py"] },
      SERVER_TENANT,
      root,
      { transport: captured.transport },
    );
    assert.equal(result.ok, true);
    if (!result.ok) {
      return;
    }
    assert.deepEqual(result.plan.arguments, {
      action: "read",
      path: "fixtures/failing-add/add.py",
    });
    assert.deepEqual(
      result.files_sent.map((file) => file.path),
      ["fixtures/failing-add/add.py", "fixtures/failing-add/test_add.py"],
    );
    const outside = await planFailingAdd(
      { input_manifest: ["fixtures/failing-add/add.py"] },
      SERVER_TENANT,
      root,
      {
        transport: () =>
          Promise.resolve(
            providerResponse(
              '{"action":"read","path":"fixtures/failing-add/test_add.py"}',
            ),
          ),
      },
    );
    assert.equal(outside.ok, false);
    if (outside.ok) {
      return;
    }
    assert.equal(outside.reason, "plan_rejected");
    assert.deepEqual(
      outside.files_sent.map((file) => file.path),
      ["fixtures/failing-add/add.py"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function expectFailure(reason: string) {
  return {
    ok: false,
    reason,
    provider: "openai",
    terms: "OpenAI Services Agreement",
    fixture: "fixtures/failing-add",
    model: PINNED_MODEL,
    files_sent: [],
    provider_contacted: false,
  };
}
