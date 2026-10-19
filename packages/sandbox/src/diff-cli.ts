import { proposeFailingAddDiff } from "./diff.ts";

const repoRoot = process.argv[2];
if (repoRoot === undefined || repoRoot.length === 0) {
  process.stderr.write("The diff needs a repository path.\n");
  process.exit(1);
}

const result = await proposeFailingAddDiff(repoRoot);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.ok) {
  process.exitCode = 1;
}
