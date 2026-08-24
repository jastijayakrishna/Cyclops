#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "LICENSE",
  "CITATION.cff",
  "docs/thesis-proposal.md",
  "docs/research-summary.md",
  "docs/research-brief.docx",
  "docs/thesis-overview.pptx",
  "docs/reproducibility.md",
  "docs/research-roadmap.md",
  "docs/methodology-questions.md",
  "results/exploratory-summary.json",
  "results/README.md",
];

const failures = [];
for (const relative of required) {
  if (!existsSync(path.join(root, relative))) failures.push(`missing ${relative}`);
}

for (const relative of [
  "README.md",
  "docs/thesis-proposal.md",
  "docs/research-summary.md",
  "docs/reproducibility.md",
  "docs/research-roadmap.md",
  "docs/methodology-questions.md",
]) {
  const target = path.join(root, relative);
  if (!existsSync(target)) continue;
  const content = readFileSync(target, "utf8");
  if (/\b(?:TBD|TODO|PLACEHOLDER)\b|\[your name\]/iu.test(content)) {
    failures.push(`${relative} contains an unresolved placeholder`);
  }
}

const proposalPath = path.join(root, "docs/thesis-proposal.md");
if (existsSync(proposalPath)) {
  const proposal = readFileSync(proposalPath, "utf8");
  for (const heading of [
    "## Research questions and hypotheses",
    "## Proposed research program",
    "## Statistical analysis and confirmation rules",
    "## Ethics, data governance, and reproducibility",
    "## Work plan and stopping rules",
    "## References",
  ]) {
    if (!proposal.includes(heading)) failures.push(`proposal missing ${heading}`);
  }
  if (/\[(your name|insert|tbd|todo)\]/iu.test(proposal)) failures.push("proposal contains an unresolved placeholder");
}

const summaryPath = path.join(root, "results/exploratory-summary.json");
if (existsSync(summaryPath)) {
  try {
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    if (summary.evidence_status !== "exploratory") failures.push("result summary must preserve exploratory status");
    if (summary.reproduction?.independently_recomputed_in_this_repository !== false) {
      failures.push("result summary must not imply raw-artifact reproduction");
    }
    if (!Array.isArray(summary.claims_boundary) || summary.claims_boundary.length < 3) {
      failures.push("result summary needs an explicit claims boundary");
    }
  } catch (error) {
    failures.push(`invalid results/exploratory-summary.json: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error("Research package check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Research package passed: ${required.length} required artifacts and claim boundaries verified.`);
