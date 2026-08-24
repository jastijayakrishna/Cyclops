#!/usr/bin/env node
// Re-analyzes the completed pilot and the RoboArena population using the
// corrected estimands:
//
//   1. two-phase / IPW  -- disagreement-only adjudication is not identifiable
//   2. powered endpoints -- flip rate carries an exact interval and an MDE
//   3. gold labels       -- reference disagreement is not judge error
//
// Usage:
//   node scripts/reanalyze-with-fixed-endpoints.js --pilot-dir <dir> --population <normalized.jsonl>

import { readFileSync } from "node:fs";
import path from "node:path";
import { comparePolicies } from "../src/compare.js";
import { adjudicateGoldLabels, measureAgainstReference } from "../src/gold-labels.js";
import { continuousShiftEndpoint, flipRateEndpoint, minimumDetectableFlipRate } from "../src/power.js";
import { createRandom } from "../src/random.js";
import { allocateTwoPhaseSample, ipwErrorRates, stratifyPhaseOne } from "../src/two-phase.js";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const readLines = (p) => readFileSync(p, "utf8").split(/\r?\n/u).filter(Boolean).map((l) => JSON.parse(l));
const pct = (v, digits = 1) => (v === null || v === undefined ? "N/A" : `${(v * 100).toFixed(digits)}%`);
const heading = (text) => console.log(`\n${"=".repeat(78)}\n${text}\n${"=".repeat(78)}`);

const pilotDir = arg("pilot-dir");
const populationPath = arg("population");
if (!pilotDir || !populationPath) {
  console.error("Both --pilot-dir and --population are required");
  process.exit(2);
}

const resultsFile = arg("results-file", "manual-judge-results.jsonl");
const analysisKey = readJson(path.join(pilotDir, "analysis-key.json"));
const judged = readLines(path.join(pilotDir, resultsFile));
const judgedById = new Map(judged.map((row) => [row.item_id, row]));
const missing = analysisKey.items.filter((item) => !judgedById.has(item.item_id));
if (missing.length > 0) {
  console.error(`${resultsFile} covers ${judgedById.size}/${analysisKey.items.length} items; ` +
    `${missing.length} unjudged (first: ${missing[0].item_id}). Complete the run before analyzing.`);
  process.exit(2);
}
const frame = analysisKey.items.map((item) => ({
  item_id: item.item_id,
  policy: item.policy,
  machine_success: judgedById.get(item.item_id).success,
  reference_success: item.human_success,
}));
console.log(`judge source: ${resultsFile}  (${[...new Set(judged.map((r) => r.model))].join(", ")})`);

// ---------------------------------------------------------------- FIX 3
heading("FIX 3 - Is it judge error, or disagreement with a single rater?");
const overall = measureAgainstReference({ items: frame });
console.log(`items                         ${overall.total}`);
console.log(`raw agreement                 ${pct(overall.raw_agreement)}`);
console.log(`measure                       ${overall.measure}`);
console.log(`judge error identifiable      ${overall.judge_error_identifiable}`);
console.log(`gold label coverage           ${pct(overall.gold_coverage)}`);
console.log(`\nreason: ${overall.reason}`);

// Both conditioning directions, because they answer different questions and the
// pilot report published only the first. Calibration consumes the second.
function classical(items) {
  const refFailure = items.filter((row) => !row.reference_success);
  const refSuccess = items.filter((row) => row.reference_success);
  return {
    fpr: refFailure.length === 0 ? null : refFailure.filter((row) => row.machine_success).length / refFailure.length,
    fnr: refSuccess.length === 0 ? null : refSuccess.filter((row) => !row.machine_success).length / refSuccess.length,
  };
}
console.log("\nTwo different conditioning directions on the same 2x2:");
console.log("                                     classical            predictive (calibration uses this)");
console.log("                                     P(m+|r-)  P(m-|r+)   P(r-|m+)  P(r+|m-)");
for (const label of ["ALL", ...[...new Set(frame.map((r) => r.policy))].sort()]) {
  const subset = label === "ALL" ? frame : frame.filter((row) => row.policy === label);
  const c = classical(subset);
  const p = measureAgainstReference({ items: subset });
  console.log(`  ${label.padEnd(34)} ${pct(c.fpr).padStart(7)} ${pct(c.fnr).padStart(9)}   ` +
    `${pct(p.machine_success_reference_failure_rate).padStart(7)} ${pct(p.machine_failure_reference_success_rate).padStart(9)}`);
}
console.log("\nThe classical pair is what docs/pilot-findings.md published. Both entries landing on");
console.log("23.5% is a coincidence of 39/166 and 8/34, not an error. But compare --calibrate learns");
console.log("P(human success | automatic verdict), so the predictive pair is what actually drives the");
console.log("correction -- and there the judge is ~10x asymmetric, not symmetric.");

// Single-rater check on the actual review data.
const singleRater = adjudicateGoldLabels({
  ratings: frame.map((row) => ({ item_id: row.item_id, rater_id: "local-manual-review", success: row.machine_success })),
});
console.log(`\nGold-label check on the completed review: usable_as_gold=${singleRater.usable_as_gold}`);
console.log(`  ${singleRater.reason}`);

// ---------------------------------------------------------------- FIX 1
heading("FIX 1 - Two-phase identifiability of the planned adjudication");
const strata = stratifyPhaseOne(frame);
console.log("Phase-one frame (machine verdict x reference verdict):");
for (const stratum of strata) {
  console.log(`  ${stratum.stratum.padEnd(42)} N=${String(stratum.population).padStart(3)}  ` +
    `${stratum.agreement ? "agreement" : "DISAGREEMENT"}`);
}

const disagreements = frame.filter((row) => row.machine_success !== row.reference_success);
console.log(`\nAs designed, the study adjudicates only the ${disagreements.length} disagreements.`);
const asDesigned = ipwErrorRates({
  items: frame,
  strata,
  sampled: disagreements.map((row) => row.item_id),
  adjudicated: disagreements.map((row) => ({ item_id: row.item_id, gold_success: row.reference_success })),
});
console.log(`  identifiable            ${asDesigned.identifiable}`);
console.log(`  false positive rate     ${asDesigned.false_positive_rate.estimate}`);
console.log(`  false negative rate     ${asDesigned.false_negative_rate.estimate}`);
console.log(`  unsampled strata        ${asDesigned.unidentifiable_strata.join(", ")}`);
console.log(`  reason                  ${asDesigned.reason}`);

const budget = disagreements.length;
const plan = allocateTwoPhaseSample({ strata, totalBudget: budget, seed: 20260812 });
console.log(`\nSame ${budget}-item budget, reallocated across all four strata:`);
for (const stratum of plan.strata) {
  console.log(`  ${stratum.stratum.padEnd(42)} n=${String(stratum.sampled).padStart(3)}/${String(stratum.population).padEnd(3)}  ` +
    `pi=${stratum.sampling_probability.toFixed(3)}`);
}
console.log("  -> every nonempty stratum sampled, so FP/FN become identifiable by IPW.");

// ---------------------------------------------------------------- FIX 2
heading("FIX 2 - Powered endpoints on the real comparison set");
const population = readLines(populationPath);
const sessions = new Map();
for (const record of population) {
  let bucket = sessions.get(record.comparison_id);
  if (!bucket) { bucket = []; sessions.set(record.comparison_id, bucket); }
  bucket.push(record);
}
const pairCounts = new Map();
for (const [, records] of sessions) {
  const policies = [...new Set(records.map((r) => r.policy))].sort();
  for (let i = 0; i < policies.length; i += 1) {
    for (let j = i + 1; j < policies.length; j += 1) {
      const key = `${policies[i]}||${policies[j]}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }
}
const eligible = [...pairCounts.entries()].filter(([, n]) => n >= 50).map(([k]) => k.split("||"));
const results = eligible.map(([baseline, candidate]) => {
  const result = comparePolicies(population, { baseline, candidate, iterations: 20000, seed: 20260811 });
  return { baseline, candidate, decision: result.decision, probability: result.probability_greater, n: result.matched_pairs };
});
const decisive = results.filter((r) => r.decision !== "INSUFFICIENT_EVIDENCE");
const flippable = results.filter((r) => (r.probability >= 0.80 && r.probability <= 0.99) || (r.probability >= 0.01 && r.probability <= 0.20));
console.log(`eligible pairs (>=50 matched sessions)   ${results.length}`);
console.log(`decisive at the 95% threshold            ${decisive.length}`);
console.log(`insufficient evidence                    ${results.length - decisive.length}`);
console.log(`in the flippable band                    ${flippable.length}`);
console.log(`\nMinimum detectable flip rate (80% power, alpha 0.05):`);
for (const n of [1, flippable.length, results.length, 104]) {
  console.log(`  ${String(n).padStart(3)} pairs -> ${pct(minimumDetectableFlipRate({ pairs: n }))}`);
}
const hypothetical = flipRateEndpoint({
  pairs: flippable.map((r, i) => ({
    pair: `${r.baseline}->${r.candidate}`,
    naive_decision: "INSUFFICIENT_EVIDENCE",
    calibrated_decision: i < 3 ? "CANDIDATE_BETTER" : "INSUFFICIENT_EVIDENCE",
    naive_probability: r.probability,
    calibrated_probability: r.probability,
  })),
});
console.log(`\nIf 3 of the ${flippable.length} flippable pairs flipped, the exact 95% interval would be ` +
  `[${pct(hypothetical.interval95.low)}, ${pct(hypothetical.interval95.high)}]`);
console.log(`  underpowered=${hypothetical.underpowered}`);
console.log(`  ${hypothetical.interpretation}`);

// Real naive-vs-calibrated contrast on the one pair that has paired labels.
heading("FIX 2 (continued) - the only real calibration contrast available");
const evidence = readLines(path.join(pilotDir, "manual-pilot-evidence.jsonl"));
const protocol = readJson(path.join(pilotDir, "protocol.json"));
const options = { baseline: protocol.baseline, candidate: protocol.candidate, iterations: 20000, seed: 20260811 };

const humanOnly = comparePolicies(evidence, options);
const machineAsTruth = comparePolicies(
  evidence.map((r) => ({ ...r, human: r.automatic_judge ? { ...r.automatic_judge, source: "machine-as-truth" } : null })),
  options,
);
console.log(`machine labels treated as truth  effect ${pct(machineAsTruth.observed_difference)}  P=${pct(machineAsTruth.probability_greater)}  ${machineAsTruth.decision}`);
console.log(`all human labels                 effect ${pct(humanOnly.observed_difference)}  P=${pct(humanOnly.probability_greater)}  ${humanOnly.decision}`);

const shiftPairs = [];
for (const reveal of [0.2, 0.5]) {
  const random = createRandom(4242);
  const held = evidence.map((r) => (random() < reveal ? r : { ...r, human: null }));
  const calibrated = comparePolicies(held, { ...options, calibrate: true });
  console.log(`calibrated, ${pct(reveal, 0).padStart(4)} human revealed  effect ${pct(calibrated.observed_difference)}  ` +
    `P=${pct(calibrated.probability_greater)}  ${calibrated.decision}`);
  shiftPairs.push({
    pair: `${protocol.baseline}->${protocol.candidate}@${reveal}`,
    naive_decision: machineAsTruth.decision,
    calibrated_decision: calibrated.decision,
    naive_probability: machineAsTruth.probability_greater,
    calibrated_probability: calibrated.probability_greater,
  });
}
const continuous = continuousShiftEndpoint({ pairs: shiftPairs });
const flips = flipRateEndpoint({ pairs: shiftPairs });
console.log(`\nPrimary (continuous) endpoint on this single pair:`);
console.log(`  mean absolute posterior shift  ${pct(continuous.mean_absolute_shift)}  ` +
  `95% CI [${pct(continuous.interval95.low)}, ${pct(continuous.interval95.high)}]`);
console.log(`  max absolute shift             ${pct(continuous.max_absolute_shift)}`);
console.log(`Secondary (flip-rate) endpoint:`);
console.log(`  flips ${flips.flips}/${flips.total_pairs}  95% CI [${pct(flips.interval95.low)}, ${pct(flips.interval95.high)}]  underpowered=${flips.underpowered}`);
console.log(`\nNOTE: this uses local manual review as the machine-judge stand-in. It is one policy`);
console.log(`pair and one reviewer, so it sizes the machinery; it does not measure Gemini bias.`);
