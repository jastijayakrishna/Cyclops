#!/usr/bin/env node
// Policy-level secondary analysis of released RoboRewardBench predictions.
// No inference, media download, or new human labeling occurs here.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildEpisodeFrame,
  buildPolicyPairFrames,
  ppiVarianceRatios,
  simulateLabelEfficiency,
  summarizePairDistortion,
} from "../src/public-benchmark.js";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const readJsonl = (file) => readFileSync(file, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const fmt = (value, digits = 3) => value === null || !Number.isFinite(value) ? "N/A" : value.toFixed(digits);

const populationPath = arg("population");
const benchmarkRootArg = arg("benchmark-root");
const outputPath = arg("output");
const minSessions = Number(arg("min-sessions", "50"));
const repetitions = Number(arg("repetitions", "1000"));
const fractions = arg("fractions", "0.1,0.2,0.3,0.5").split(",").map(Number);
const seed = Number(arg("seed", "20260813"));
if (!populationPath || !benchmarkRootArg) {
  console.error("--population and --benchmark-root are required");
  process.exit(2);
}
const benchmarkRoot = path.resolve(benchmarkRootArg);
const manifest = readJson(path.join(benchmarkRoot, "manifest.json"));
const instances = readJson(path.join(benchmarkRoot, manifest.instances.file));
const population = readJsonl(populationPath);

console.log("PUBLIC-PREDICTION POLICY STUDY (exploratory; results already observed)");
console.log(`benchmark ${manifest.benchmark} ${manifest.benchmark_version}, retrieved ${manifest.retrieved_at}`);
console.log(`instances=${instances.length}, models=${manifest.models.length}, min_sessions=${minSessions}`);
console.log(`label simulation fractions=${fractions.join(",")}, repetitions=${repetitions}, seed=${seed}`);
console.log("Target: finite-set mean of the human-verified RoboRewardBench reference scores.");
console.log("Unit: matched RoboArena session; camera views are averaged within policy episode.\n");

const modelResults = [];
for (let modelIndex = 0; modelIndex < manifest.models.length; modelIndex += 1) {
  const modelEntry = manifest.models[modelIndex];
  const predictions = readJson(path.join(benchmarkRoot, modelEntry.file));
  const frame = buildEpisodeFrame({ instances, predictions, population });
  const pairs = buildPolicyPairFrames(frame.episodes, { minSessions });
  const pairResults = pairs.map((pair, pairIndex) => {
    const distortion = summarizePairDistortion(pair);
    const variance = ppiVarianceRatios(pair.rows);
    const simulation = simulateLabelEfficiency(pair.rows, {
      fractions,
      repetitions,
      seed: (seed + modelIndex * 1009 + pairIndex * 9176) >>> 0,
    });
    return { ...distortion, variance, simulation };
  });
  const episodeMae = frame.episodes.length === 0 ? null : mean(frame.episodes.map((episode) => Math.abs(episode.prediction_score - episode.reference_score)));
  modelResults.push({
    model: modelEntry.model,
    source: modelEntry,
    diagnostics: frame.diagnostics,
    episodes: frame.episodes.length,
    sessions: new Set(frame.episodes.map((episode) => episode.comparison_id)).size,
    multi_view_episodes: frame.episodes.filter((episode) => episode.view_count > 1).length,
    policies: new Set(frame.episodes.map((episode) => episode.policy)).size,
    sites: new Set(frame.episodes.map((episode) => episode.site)).size,
    episode_mae: episodeMae,
    eligible_pairs: pairResults.length,
    mean_absolute_policy_effect_shift: pairResults.length === 0 ? null : mean(pairResults.map((pair) => Math.abs(pair.effect_shift))),
    sign_reversals: pairResults.filter((pair) => pair.sign_reversal).length,
    decision_changes: pairResults.filter((pair) => pair.decision_change).length,
    median_fixed_variance_ratio: median(pairResults.map((pair) => pair.variance.fixed_variance_ratio)),
    median_oracle_variance_ratio: median(pairResults.map((pair) => pair.variance.oracle_variance_ratio)),
    median_oracle_lambda: median(pairResults.map((pair) => pair.variance.oracle_lambda)),
    pairs: pairResults,
  });
}

modelResults.sort((left, right) => (left.episode_mae ?? Infinity) - (right.episode_mae ?? Infinity));
console.log("MODEL SUMMARY");
console.log("model                                                     episodes  MAE   pairs  shift reversals changes fixedVR oracleVR");
for (const result of modelResults) {
  console.log(`${result.model.padEnd(57)} ${String(result.episodes).padStart(4)}  ${fmt(result.episode_mae).padStart(5)}  ` +
    `${String(result.eligible_pairs).padStart(3)}  ${fmt(result.mean_absolute_policy_effect_shift).padStart(5)} ` +
    `${String(result.sign_reversals).padStart(4)} ${String(result.decision_changes).padStart(7)} ` +
    `${fmt(result.median_fixed_variance_ratio, 2).padStart(7)} ${fmt(result.median_oracle_variance_ratio, 2).padStart(8)}`);
}

function aggregateSimulation(result) {
  return fractions.map((fraction) => {
    const rows = result.pairs.flatMap((pair) => pair.simulation.filter((entry) => entry.fraction === fraction));
    const methods = {};
    for (const name of ["human_only", "fixed_ppi", "adaptive_ppi"]) {
      methods[name] = {
        coverage: mean(rows.map((row) => row.methods[name].coverage)),
        mean_absolute_error: mean(rows.map((row) => row.methods[name].mean_absolute_error)),
        mean_interval_width: mean(rows.map((row) => row.methods[name].mean_interval_width)),
        ranking_agreement: mean(rows.map((row) => row.methods[name].ranking_agreement)),
        mean_lambda: mean(rows.map((row) => row.methods[name].mean_lambda)),
      };
    }
    return { fraction, pairs: rows.length, methods };
  });
}
for (const result of modelResults) result.label_efficiency = aggregateSimulation(result);

for (const modelName of ["google/gemini-2.5-flash-lite", "qwen/qwen3-vl-8b-instruct-robo-reward"]) {
  const result = modelResults.find((entry) => entry.model === modelName);
  if (!result) continue;
  console.log(`\nLABEL RECONSTRUCTION: ${modelName}`);
  console.log("fraction method          coverage   MAE   width rank-agree lambda");
  for (const row of result.label_efficiency) {
    for (const name of ["human_only", "fixed_ppi", "adaptive_ppi"]) {
      const method = row.methods[name];
      console.log(`${String(Math.round(row.fraction * 100)).padStart(3)}%     ${name.padEnd(13)} ${fmt(method.coverage).padStart(8)} ` +
        `${fmt(method.mean_absolute_error).padStart(5)} ${fmt(method.mean_interval_width).padStart(6)} ` +
        `${fmt(method.ranking_agreement).padStart(10)} ${fmt(method.mean_lambda).padStart(6)}`);
    }
  }
}

const output = {
  schema_version: 1,
  status: "exploratory_secondary_analysis",
  // Keep analysis bytes deterministic for a fixed downloaded manifest and
  // seed. The manifest already records when the public inputs were retrieved.
  source_retrieved_at: manifest.retrieved_at,
  claims_boundary: {
    reference: "Human-verified RoboRewardBench reference; not independent blinded multi-rater gold.",
    judge_contract: "Full-video 1-5 progress prompt; not the frozen eight-frame binary-success pilot prompt.",
    target: "Finite benchmark-set policy effect; external generalization is not established.",
    model_selection: "All released runs were inspected; model comparisons are exploratory, not confirmatory.",
  },
  inputs: { population: populationPath, benchmark_manifest: path.join(benchmarkRoot, "manifest.json") },
  settings: { min_sessions: minSessions, repetitions, fractions, seed, camera_aggregation: "episode mean" },
  models: modelResults,
};
if (outputPath) {
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${outputPath}`);
}
