import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  GUEST_WORKSPACE,
  SLICE1_SANDBOX_LABEL,
  bubblewrapVersion,
  runSlice1Sandbox,
} from "./bwrap.ts";
import type { FixtureManifest } from "./bwrap.ts";
import { readManifestFile, runFixtureUnittest } from "./tool.ts";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.join(packageRoot, "..", "..");
const failingAddRoot = path.join(repoRoot, "fixtures", "failing-add");

const failingAdd: FixtureManifest = {
  root: failingAddRoot,
  files: ["add.py", "test_add.py"],
};

const PATH_PROBE = [
  "import os, sys",
  "print('sibling', os.path.exists('/workspace/outside-manifest.txt'))",
  "print('passwd', os.path.exists('/etc/passwd'))",
  "print('docker-var', os.path.exists('/var/run/docker.sock'))",
  "print('docker-run', os.path.exists('/run/docker.sock'))",
  "print('files', ','.join(sorted(os.listdir('/workspace'))))",
  "print('hostpath', os.path.exists(sys.argv[1]))",
  "try:",
  "    open('/etc/passwd', 'r')",
  "    print('passwd-open', 'opened')",
  "except OSError as exc:",
  "    print('passwd-open', exc.errno)",
].join("\n");

const NETWORK_PROBE = [
  "import socket, sys",
  "def attempt(host, port):",
  "    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)",
  "    sock.settimeout(2)",
  "    try:",
  "        sock.connect((host, port))",
  "    except OSError as exc:",
  "        print(f'{host} {exc.errno}')",
  "    else:",
  "        print(f'{host} connected')",
  "    finally:",
  "        sock.close()",
  "attempt('127.0.0.1', int(sys.argv[1]))",
  "attempt('1.1.1.1', 443)",
].join("\n");

function bindSources(argv: readonly string[]): string[] {
  const sources: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--ro-bind") {
      sources.push(argv[index + 1] ?? "");
    }
  }
  return sources;
}

function connectTcp(host: string, port: number): Promise<"connected" | string> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, family: 4 });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve("timeout");
    }, 3000);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve("connected");
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(error.code ?? "error");
    });
  });
}

test("bubblewrap is the runtime on this machine", () => {
  const version = bubblewrapVersion();
  assert.equal(version, "bubblewrap 0.9.0");
  assert.equal(
    SLICE1_SANDBOX_LABEL,
    "slice 1 sandbox, not a production-grade boundary",
  );
  const readme = readFileSync(path.join(repoRoot, "README.md"), "utf8");
  assert.equal(readme.includes(SLICE1_SANDBOX_LABEL), true);
});

test("a path outside the manifest is denied", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "slice1-manifest-"));
  try {
    writeFileSync(path.join(directory, "add.py"), "def add(left, right):\n    return left + right + 1\n");
    writeFileSync(path.join(directory, "test_add.py"), "import unittest\n");
    const outside = path.join(directory, "outside-manifest.txt");
    writeFileSync(outside, "host-only\n");
    const manifest: FixtureManifest = {
      root: directory,
      files: ["add.py", "test_add.py"],
    };
    const ran = await runSlice1Sandbox(manifest, [
      "python3",
      "-c",
      PATH_PROBE,
      outside,
    ]);
    assert.equal(ran.ok, true);
    if (!ran.ok) {
      return;
    }
    assert.equal(ran.exitCode, 0);
    assert.match(ran.stdout, /^sibling False$/m);
    assert.match(ran.stdout, /^passwd False$/m);
    assert.match(ran.stdout, /^docker-var False$/m);
    assert.match(ran.stdout, /^docker-run False$/m);
    assert.match(ran.stdout, /^files add\.py,test_add\.py$/m);
    assert.match(ran.stdout, /^hostpath False$/m);
    assert.match(ran.stdout, /^passwd-open 2$/m);
    const sources = bindSources(ran.argv);
    assert.equal(sources.includes(outside), false);
    assert.equal(sources.includes("/etc/passwd"), false);
    assert.equal(sources.some((source) => source.includes("docker.sock")), false);
    assert.equal(ran.argv.includes("--unshare-all"), true);
    assert.equal(ran.argv.includes("--unshare-net"), true);
    assert.equal(ran.argv.includes("bash"), false);
    assert.equal(ran.argv.includes("sh"), false);
    assert.deepEqual(
      await readManifestFile(manifest, "outside-manifest.txt"),
      { ok: false, reason: "not_in_manifest" },
    );
    assert.deepEqual(await readManifestFile(manifest, "../add.py"), {
      ok: false,
      reason: "not_in_manifest",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a symlink is not accepted as a manifest file", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "slice1-symlink-"));
  try {
    writeFileSync(path.join(directory, "add.py"), "def add(left, right):\n    return 0\n");
    symlinkSync("/etc/passwd", path.join(directory, "test_add.py"));
    const ran = await runSlice1Sandbox(
      { root: directory, files: ["add.py", "test_add.py"] },
      ["python3", "-c", "print('ran')"],
    );
    assert.deepEqual(ran, { ok: false, reason: "invalid_manifest" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a network attempt is denied by the sandbox", async () => {
  const server = net.createServer((socket) => {
    socket.end();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("listener has no port");
  }
  try {
    assert.equal(await connectTcp("127.0.0.1", address.port), "connected");
    assert.equal(await connectTcp("1.1.1.1", 443), "connected");
    const ran = await runSlice1Sandbox(failingAdd, [
      "python3",
      "-c",
      NETWORK_PROBE,
      String(address.port),
    ]);
    assert.equal(ran.ok, true);
    if (!ran.ok) {
      return;
    }
    assert.equal(ran.exitCode, 0);
    assert.match(ran.stdout, /^127\.0\.0\.1 111$/m);
    assert.match(ran.stdout, /^1\.1\.1\.1 101$/m);
    assert.equal(ran.stdout.includes("connected"), false);
    assert.equal(ran.argv.includes("--unshare-net"), true);
    assert.equal(ran.argv.includes("bash"), false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});

test("the unittest command runs inside the workspace", async () => {
  const ran = await runFixtureUnittest(failingAdd);
  assert.equal(ran.ok, true);
  if (!ran.ok) {
    return;
  }
  assert.equal(ran.argv.at(-3), "python3");
  assert.equal(ran.argv.at(-2), "-m");
  assert.equal(ran.argv.at(-1), "unittest");
  assert.equal(ran.argv.includes("--chdir"), true);
  assert.equal(ran.argv.includes(GUEST_WORKSPACE), true);
  assert.notEqual(ran.exitCode, 0);
  assert.match(ran.stderr, /File "\/workspace\/test_add\.py", line 8/);
  assert.match(ran.stderr, /AssertionError: 6 != 5/);
  assert.match(ran.stderr, /FAILED \(failures=1\)/);
  const source = await readManifestFile(failingAdd, "add.py");
  assert.equal(source.ok, true);
  if (!source.ok) {
    return;
  }
  assert.match(source.text, /return left \+ right \+ 1/);
  assert.equal(source.text.includes("return left + right\n"), false);
});
