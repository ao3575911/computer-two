import { planFailingAdd } from "./model-adapter.ts";

const repoRoot = process.argv[2];
if (repoRoot === undefined || repoRoot.length === 0) {
  process.stderr.write("The planner needs a repository path.\n");
  process.exit(1);
}

const result = await planFailingAdd(
  {
    schema_version: "0.1",
    mission_id: "failing-add",
    input_manifest: [
      "fixtures/failing-add/add.py",
      "fixtures/failing-add/test_add.py",
    ],
  },
  "server-tenant",
  repoRoot,
);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.ok) {
  process.exitCode = 1;
}
