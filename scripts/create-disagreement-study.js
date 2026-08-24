#!/usr/bin/env node
import path from "node:path";
import { createDisagreementStudy } from "../src/disagreement-study.js";

const pilotDir = process.argv[2];
const seed = Number(process.argv[3] ?? 20260812);
if (!pilotDir || !Number.isInteger(seed)) {
  console.error("Usage: node scripts/create-disagreement-study.js <pilot-dir> [seed]");
  process.exit(2);
}

const result = await createDisagreementStudy({
  pilotDir,
  studyDir: path.join(path.resolve(pilotDir), "disagreement-rereview"),
  seed,
});
console.log(`Frozen ${result.selectedItems} disagreements at ${result.studyDir}`);
console.log(`Strict shuffle seed ${result.strictSeed}; progress-aware shuffle seed ${result.progressSeed}`);

