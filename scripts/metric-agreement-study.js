#!/usr/bin/env node
// Step 1: does the choice of HUMAN evaluation metric change the conclusion?
//
// RoboArena carries two independent human judgments per session: a per-policy
// binary task-success label, and a direct A/B/TIE preference. Both are already in
// the normalized file. This compares the two on identical sessions, across every
// policy pair with enough matched evidence, using the powered endpoints.
//
// No API calls, no downloads, no new labels.
//
//   node scripts/metric-agreement-study.js --population <normalized.jsonl> [--min-sessions 50]

import { readFileSync, writeFileSync } from "node:fs";
import { comparePreference, matchedPreferenceSessions } from "../src/preference.js";
import { continuousShiftEndpoint, flipRateEndpoint, minimumDetectableFlipRate } from "../src/power.js";
import { observedDifference, pairedPosterior } from "../src/statistics.js";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}
const pct = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? "N/A" : `${(v * 100).toFixed(d)}%`);
const heading = (t) => console.log(`\n${"=".repeat(86)}\n${t}\n${"=".repeat(86)}`);

const populationPath = arg("population");
const minSessions = Number(arg("min-sessions", "50"));
const seed = Number(arg("seed", "20260812"));
const iterations = Number(arg("iterations", "20000"));
const outputPath = arg("output");
if (!populationPath) { console.error("--population is required"); process.exit(2); }

const records = readFileSync(populationPath, "utf8").split(/\r?\n/u).filter(Boolean).map((l) => JSON.parse(l));
const sessions = matchedPreferenceSessions(records);

heading("PREREGISTERED SETUP (frozen before reading any result below)");
console.log(`population records                ${records.length}`);
console.log(`sessions with a usable A/B preference and both success labels   ${sessions.length}`);
console.log(`minimum matched sessions per pair ${minSessions}`);
console.log(`seed ${seed}, iterations ${iterations}, decision threshold 95%`);
console.log(`\nPrimary endpoint   mean absolute shift in P(candidate better) between the two metrics`);
console.log(`Secondary endpoint decision-flip rate with an exact Clopper-Pearson interval`);
console.log(`\nA session-level preference names the A or B slot only, so each session contributes`);
console.log(`exactly one preference comparison even when it contains seven policies.`);

heading("VALIDITY CHECKS (run before interpreting any effect)");
const aWins = sessions.filter((row) => row.preference === "A").length;
const bWins = sessions.filter((row) => row.preference === "B").length;
const slotSuccessA = sessions.filter((row) => row.success_a).length / sessions.length;
const slotSuccessB = sessions.filter((row) => row.success_b).length / sessions.length;
console.log(`slot-position bias   A preferred ${aWins}, B preferred ${bWins} ` +
  `-> A share among decided ${pct(aWins / (aWins + bWins))}`);
console.log(`                     binary success by slot: A ${pct(slotSuccessA)}, B ${pct(slotSuccessB)}`);
console.log(`                     ${Math.abs(aWins / (aWins + bWins) - 0.5) < 0.03 ? "PASS - no material position bias" : "WARN - position bias present"}`);

const discriminating = sessions.filter((row) => row.success_a !== row.success_b);
const agrees = discriminating.filter((row) =>
  (row.success_a && row.preference === "A") || (row.success_b && row.preference === "B")).length;
const contradicts = discriminating.filter((row) =>
  (row.success_a && row.preference === "B") || (row.success_b && row.preference === "A")).length;
console.log(`\nmetric coherence     on the ${discriminating.length} sessions where exactly one policy succeeded,`);
console.log(`                     preference agreed with the successful policy ${agrees} times (${pct(agrees / discriminating.length)})`);
console.log(`                     and picked the failed policy ${contradicts} times (${pct(contradicts / discriminating.length)})`);
console.log(`                     ${contradicts / discriminating.length < 0.05 ? "PASS - preference is not noise; it contains the success signal" : "WARN - metrics contradict"}`);

const bothFailed = sessions.filter((row) => !row.success_a && !row.success_b);
const bothFailedDecided = bothFailed.filter((row) => row.preference !== "TIE").length;
console.log(`\nmetric saturation    ${bothFailed.length}/${sessions.length} sessions (${pct(bothFailed.length / sessions.length)}) had BOTH policies fail,`);
console.log(`                     so binary success cannot separate them at all.`);
console.log(`                     Humans still named a winner in ${bothFailedDecided} of those (${pct(bothFailedDecided / bothFailed.length)}).`);
console.log(`                     This is the mechanism behind any shift below: binary success discards`);
console.log(`                     the graded signal that preference retains.`);

const counts = new Map();
for (const row of sessions) {
  const key = [row.policy_a, row.policy_b].sort().join("||");
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const eligible = [...counts.entries()]
  .filter(([, n]) => n >= minSessions)
  .map(([key]) => key.split("||"))
  .sort((left, right) => left.join().localeCompare(right.join()));

const rows = [];
for (const [baseline, candidate] of eligible) {
  const preference = comparePreference(records, { baseline, candidate, seed, iterations });
  const successCounts = [
    preference.success_counts.both_failure,
    preference.success_counts.candidate_only,
    preference.success_counts.baseline_only,
    preference.success_counts.both_success,
  ];
  const successPosterior = pairedPosterior(successCounts, { iterations, seed });
  const successDecision = successPosterior.probability_greater >= 0.95
    ? "CANDIDATE_BETTER"
    : successPosterior.probability_less >= 0.95 ? "BASELINE_BETTER" : "INSUFFICIENT_EVIDENCE";
  rows.push({
    pair: `${baseline} -> ${candidate}`,
    baseline,
    candidate,
    n: preference.matched_sessions,
    success_effect: observedDifference(successCounts),
    success_probability: successPosterior.probability_greater,
    success_decision: successDecision,
    preference_effect: preference.observed_difference,
    preference_probability: preference.probability_greater,
    preference_decision: preference.decision,
    ties: preference.counts.tie,
  });
}

heading(`RESULTS - ${rows.length} policy pairs, same sessions, two human metrics`);
console.log("                                                             SUCCESS METRIC        PREFERENCE METRIC");
console.log("pair                                             n     eff    P     decision      eff    P     decision   shift");
console.log("-".repeat(120));
for (const row of [...rows].sort((a, b) =>
  Math.abs(b.preference_probability - b.success_probability) - Math.abs(a.preference_probability - a.success_probability))) {
  const shift = Math.abs(row.preference_probability - row.success_probability);
  const short = (name) => name.replace(/_droid$/u, "").replace(/paligemma_/u, "pg_");
  console.log(
    `${`${short(row.baseline)} -> ${short(row.candidate)}`.padEnd(46)} ${String(row.n).padStart(4)}  ` +
    `${pct(row.success_effect, 0).padStart(5)} ${pct(row.success_probability, 0).padStart(5)} ${row.success_decision === "INSUFFICIENT_EVIDENCE" ? "  ----  " : row.success_decision === "CANDIDATE_BETTER" ? "  CAND  " : "  BASE  "}  ` +
    `${pct(row.preference_effect, 0).padStart(5)} ${pct(row.preference_probability, 0).padStart(5)} ${row.preference_decision === "INSUFFICIENT_EVIDENCE" ? "  ----  " : row.preference_decision === "CANDIDATE_BETTER" ? "  CAND  " : "  BASE  "} ` +
    `${pct(shift, 0).padStart(6)}`);
}

const endpointPairs = rows.map((row) => ({
  pair: row.pair,
  naive_decision: row.success_decision,
  calibrated_decision: row.preference_decision,
  naive_probability: row.success_probability,
  calibrated_probability: row.preference_probability,
}));
const continuous = continuousShiftEndpoint({ pairs: endpointPairs });
const flips = flipRateEndpoint({ pairs: endpointPairs });
const rankingDisagreements = rows.filter((row) =>
  Math.sign(row.success_effect) !== 0 && Math.sign(row.preference_effect) !== 0 &&
  Math.sign(row.success_effect) !== Math.sign(row.preference_effect));

heading("ENDPOINTS");
console.log(`PRIMARY   mean absolute shift in P(candidate better)   ${pct(continuous.mean_absolute_shift)}`);
console.log(`          95% CI                                       [${pct(continuous.interval95.low)}, ${pct(continuous.interval95.high)}]`);
console.log(`          max shift on any pair                        ${pct(continuous.max_absolute_shift)}`);
console.log(`          pairs                                        ${continuous.pairs}`);
console.log(`\nSECONDARY decision flips                               ${flips.flips}/${flips.total_pairs} (${pct(flips.rate)})`);
console.log(`          exact 95% CI                                 [${pct(flips.interval95.low)}, ${pct(flips.interval95.high)}]`);
console.log(`          minimum detectable rate at this n            ${pct(minimumDetectableFlipRate({ pairs: rows.length }))}`);
console.log(`          underpowered                                 ${flips.underpowered}`);
if (flips.flipped_pairs.length > 0) {
  console.log("\n          flipped pairs:");
  for (const flip of flips.flipped_pairs) console.log(`            ${flip.pair}: ${flip.from} -> ${flip.to}`);
}
console.log(`\nRANKING   pairs where the two metrics disagree on sign  ${rankingDisagreements.length}/${rows.length} (${pct(rankingDisagreements.length / rows.length)})`);
for (const row of rankingDisagreements) {
  console.log(`            ${row.pair}: success ${pct(row.success_effect, 1)} vs preference ${pct(row.preference_effect, 1)}`);
}

heading("READING THIS");
console.log("Both metrics are human. Neither is a machine judge. A large shift here means the");
console.log("CHOICE OF HUMAN METRIC moves the conclusion, which is the premise underneath the");
console.log("judge-bias thesis. It is not itself evidence that any automatic judge is biased.");
console.log("\nPreference and binary success are also not the same construct: preference is");
console.log("relative and admits ties, success is absolute and per-policy. Disagreement between");
console.log("them is expected to some degree; the question is the magnitude.");

if (outputPath) {
  writeFileSync(outputPath, `${JSON.stringify({
    generated_at: new Date().toISOString(),
    population: populationPath,
    settings: { min_sessions: minSessions, seed, iterations, threshold: 0.95 },
    preference_sessions: sessions.length,
    pairs: rows,
    endpoints: { primary: continuous, secondary: flips, ranking_disagreements: rankingDisagreements.length },
  }, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${outputPath}`);
}
