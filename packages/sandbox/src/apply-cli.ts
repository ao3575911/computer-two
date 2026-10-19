import { applyReviewedPatch, createDispatchGate } from "./apply.ts";

const repoRoot = process.argv[2];
const baseDigest = process.argv[3];
const resultSha256 = process.argv[4];
if (
  repoRoot === undefined ||
  repoRoot.length === 0 ||
  baseDigest === undefined ||
  resultSha256 === undefined
) {
  process.stderr.write("The apply needs a repository path and the reviewed hashes.\n");
  process.exit(1);
}

const result = await applyReviewedPatch(
  repoRoot,
  { baseDigest, resultSha256 },
  createDispatchGate(),
);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.ok) {
  process.exitCode = 1;
}
