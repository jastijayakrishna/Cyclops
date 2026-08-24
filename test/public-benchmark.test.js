import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEpisodeFrame,
  buildPolicyPairFrames,
  parseProgressPrediction,
  parseRoboRewardInstanceId,
  ppiVarianceRatios,
  simulateLabelEfficiency,
} from "../src/public-benchmark.js";

test("parses benchmark IDs and strict progress answers", () => {
  assert.deepEqual(parseRoboRewardInstanceId("d2e85113-3d81-47c2-9d00-24773db0ed52_E_left:587"), {
    comparison_id: "d2e85113-3d81-47c2-9d00-24773db0ed52",
    slot: "E",
    view: "left",
    benchmark_index: 587,
    trial_id: "d2e85113-3d81-47c2-9d00-24773db0ed52:E",
    stable_id: "d2e85113-3d81-47c2-9d00-24773db0ed52_E_left",
  });
  assert.equal(parseProgressPrediction("reasoning\nANSWER: **4**"), 4);
  assert.equal(parseProgressPrediction(" 2 "), 2);
  assert.equal(parseProgressPrediction("probably four"), null);
});

test("aggregates camera views within an episode and joins policy metadata", () => {
  const id = "d2e85113-3d81-47c2-9d00-24773db0ed52_E";
  const instances = ["left", "wrist"].map((view, index) => ({
    id: `${id}_${view}:${index}`,
    references: [{ output: { text: "3" }, tags: ["correct"] }],
  }));
  const predictions = [
    // Numeric HELM suffixes differ across released model runs and must not be
    // used as the cross-run join key.
    { instance_id: `${id}_left:700`, predicted_text: "ANSWER: 2" },
    { instance_id: `${id}_wrist:701`, predicted_text: "ANSWER: 4" },
  ];
  const population = [{
    trial_id: "d2e85113-3d81-47c2-9d00-24773db0ed52:E",
    comparison_id: "d2e85113-3d81-47c2-9d00-24773db0ed52",
    policy: "policy-e", task: "task", site: "site",
  }];
  const result = buildEpisodeFrame({ instances, predictions, population });
  assert.equal(result.episodes.length, 1);
  assert.equal(result.episodes[0].prediction_score, 3);
  assert.equal(result.episodes[0].reference_score, 3);
  assert.equal(result.episodes[0].view_count, 2);
});

test("builds session-matched policy differences", () => {
  const episodes = [];
  for (let session = 0; session < 3; session += 1) {
    for (const [policy, reference, prediction] of [["a", 1, 2], ["b", 3, 5]]) {
      episodes.push({ comparison_id: `s${session}`, trial_id: `s${session}:${policy}`, policy, task: "t", site: "x", reference_score: reference, prediction_score: prediction });
    }
  }
  const pairs = buildPolicyPairFrames(episodes, { minSessions: 3 });
  assert.equal(pairs.length, 1);
  assert.deepEqual(pairs[0].rows.map((row) => [row.human, row.proxy]), [[2, 3], [2, 3], [2, 3]]);
});

test("adaptive PPI falls back to human-only when the proxy is anticorrelated", () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({ human: index - 10, proxy: 10 - index }));
  const ratios = ppiVarianceRatios(rows);
  assert.equal(ratios.oracle_lambda, 0);
  assert.equal(ratios.oracle_variance_ratio, 1);
  const first = simulateLabelEfficiency(rows, { fractions: [0.5], repetitions: 50, seed: 7 });
  const second = simulateLabelEfficiency(rows, { fractions: [0.5], repetitions: 50, seed: 7 });
  assert.deepEqual(first, second);
  assert.equal(first[0].methods.adaptive_ppi.mean_lambda, 0);
  assert.deepEqual(first[0].methods.adaptive_ppi, first[0].methods.human_only);
});
