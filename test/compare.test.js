import assert from "node:assert/strict";
import test from "node:test";
import { auditJudge } from "../src/audit.js";
import { comparePolicies } from "../src/compare.js";
import { UserError } from "../src/errors.js";

function record({ comparison, policy, human = null, automatic = null, task = "drawer", site = "lab" }) {
  return {
    schema_version: 1,
    trial_id: `${comparison}:${policy}`,
    comparison_id: comparison,
    policy,
    task,
    site,
    timestamp: null,
    automatic_judge: automatic === null ? null : { score: automatic ? 0.8 : 0.2, success: automatic },
    human: human === null ? null : { score: Number(human), success: human, source: "test" },
    video_paths: [],
    source: { dataset: "synthetic", metadata_path: `${comparison}.yaml` },
  };
}

function humanPairs(outcomes) {
  return outcomes.flatMap(([baseline, candidate], index) => [
    record({ comparison: `pair-${index}`, policy: "policy-a", human: baseline }),
    record({ comparison: `pair-${index}`, policy: "policy-b", human: candidate }),
  ]);
}

test("finds a candidate improvement from matched human evidence deterministically", () => {
  const outcomes = [
    ...Array.from({ length: 30 }, () => [false, true]),
    ...Array.from({ length: 8 }, () => [true, false]),
    ...Array.from({ length: 32 }, () => [true, true]),
    ...Array.from({ length: 30 }, () => [false, false]),
  ];
  const options = {
    baseline: "policy-a",
    candidate: "policy-b",
    iterations: 5000,
    seed: 42,
  };
  const first = comparePolicies(humanPairs(outcomes), options);
  const second = comparePolicies(humanPairs(outcomes), options);
  assert.deepEqual(first, second);
  assert.equal(first.decision, "CANDIDATE_BETTER");
  assert.equal(first.observed_difference, 0.22);
  assert.ok(first.probability_greater > 0.99);
  assert.equal(first.planner.action, "STOP");
});

test("returns a bounded next batch when human evidence is insufficient", () => {
  const outcomes = [
    [false, true], [true, false], [true, true], [false, false],
    [false, true], [true, false], [true, true], [false, false],
  ];
  const result = comparePolicies(humanPairs(outcomes), {
    baseline: "policy-a",
    candidate: "policy-b",
    iterations: 3000,
    seed: 7,
  });
  assert.equal(result.decision, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.planner.action, "TEST");
  assert.equal(result.planner.trials.matched_pairs, 12);
  assert.equal(result.planner.reason, "effect_too_small_or_unstable_to_project");
});

test("a positive minimum effect does not mislabel practical equivalence as baseline better", () => {
  const outcomes = [
    ...Array.from({ length: 125 }, () => [false, true]),
    ...Array.from({ length: 125 }, () => [true, false]),
    ...Array.from({ length: 125 }, () => [true, true]),
    ...Array.from({ length: 125 }, () => [false, false]),
  ];
  const result = comparePolicies(humanPairs(outcomes), {
    baseline: "policy-a",
    candidate: "policy-b",
    minEffect: 0.1,
    iterations: 5000,
    seed: 17,
  });
  assert.equal(result.decision, "INSUFFICIENT_EVIDENCE");
  assert.ok(result.probability_greater < 0.05);
  assert.ok(result.probability_less < 0.05);
});

function calibratedFixture() {
  const records = [];
  for (let index = 0; index < 20; index += 1) {
    const baselineAutomatic = index < 10;
    const candidateAutomatic = index < 10;
    const baselineHuman = baselineAutomatic ? index < 9 : index < 16;
    const candidateHuman = candidateAutomatic ? index < 6 : index < 12;
    records.push(
      record({ comparison: `cal-${index}`, policy: "policy-a", automatic: baselineAutomatic, human: baselineHuman }),
      record({ comparison: `cal-${index}`, policy: "policy-b", automatic: candidateAutomatic, human: candidateHuman }),
    );
  }
  for (let index = 0; index < 80; index += 1) {
    records.push(
      record({ comparison: `machine-${index}`, policy: "policy-a", automatic: index < 40 }),
      record({ comparison: `machine-${index}`, policy: "policy-b", automatic: index < 60 }),
    );
  }
  return records;
}

test("propagates judge calibration and can reverse a naive machine ranking", () => {
  const result = comparePolicies(calibratedFixture(), {
    baseline: "policy-a",
    candidate: "policy-b",
    calibrate: true,
    minimumCalibrationLabels: 20,
    iterations: 5000,
    seed: 99,
  });
  assert.ok(result.observed_difference > 0.15, "machine judge should rank candidate higher");
  assert.ok(result.mean < -0.1, "calibrated estimate should rank baseline higher");
  assert.ok(result.judge_correction < -0.25);
  assert.equal(result.decision, "BASELINE_BETTER");
});

test("calibration fails closed when paired machine/human evidence is absent", () => {
  const records = humanPairs([[false, true], [true, false]]);
  assert.throws(
    () => comparePolicies(records, {
      baseline: "policy-a",
      candidate: "policy-b",
      calibrate: true,
      iterations: 1000,
    }),
    (error) => error instanceof UserError && /Cannot calibrate policy-a/u.test(error.message),
  );
});

test("judge audit reports standard false-positive and false-negative denominators", () => {
  const records = [
    record({ comparison: "1", policy: "policy-a", automatic: true, human: true }),
    record({ comparison: "2", policy: "policy-a", automatic: true, human: false }),
    record({ comparison: "3", policy: "policy-a", automatic: false, human: true }),
    record({ comparison: "4", policy: "policy-a", automatic: false, human: false }),
  ];
  const audit = auditJudge(records, ["policy", "task", "site"]);
  assert.equal(audit.overall.false_positive_rate.rate, 0.5);
  assert.equal(audit.overall.false_negative_rate.rate, 0.5);
  assert.equal(audit.groups.policy[0].paired_labels, 4);
});
