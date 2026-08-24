import { UserError } from "./errors.js";
import { automaticSuccess, humanSuccess, matchedPairs } from "./evidence.js";
import { planEvidence } from "./planner.js";
import { createRandom, dirichletSample } from "./random.js";
import {
  calibrationCells,
  observedDifference,
  pairedOutcomeCounts,
  pairedPosterior,
  sampleCalibration,
  summarizeDraws,
} from "./statistics.js";

function decide(candidateProbability, baselineProbability, threshold) {
  if (candidateProbability >= threshold) return "CANDIDATE_BETTER";
  if (baselineProbability >= threshold) return "BASELINE_BETTER";
  return "INSUFFICIENT_EVIDENCE";
}

function calibrationSummary(cells) {
  const falseCount = cells.false.human_success + cells.false.human_failure;
  const trueCount = cells.true.human_success + cells.true.human_failure;
  return {
    paired_labels: falseCount + trueCount,
    automatic_failure_labels: falseCount,
    automatic_success_labels: trueCount,
  };
}

function assertCalibrationSupport(records, policy, minimumLabels) {
  const cells = calibrationCells(records, policy);
  const summary = calibrationSummary(cells);
  if (summary.paired_labels < minimumLabels ||
      summary.automatic_failure_labels === 0 ||
      summary.automatic_success_labels === 0) {
    throw new UserError(
      `Cannot calibrate ${policy}: need at least ${minimumLabels} paired machine/human labels and both automatic verdict classes; ` +
      `found ${summary.paired_labels} labels (${summary.automatic_failure_labels} automatic failures, ` +
      `${summary.automatic_success_labels} automatic successes).`,
    );
  }
  return { cells, summary };
}

function calibratedPosterior(pairs, calibration, options) {
  const random = createRandom(options.seed);
  const draws = new Array(options.iterations);
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const baselineCalibration = sampleCalibration(calibration.baseline.cells, random);
    const candidateCalibration = sampleCalibration(calibration.candidate.cells, random);
    const counts = [0, 0, 0, 0];

    for (const pair of pairs) {
      const directBaseline = humanSuccess(pair.baseline);
      const directCandidate = humanSuccess(pair.candidate);
      const baselineAutomatic = automaticSuccess(pair.baseline);
      const candidateAutomatic = automaticSuccess(pair.candidate);
      const baseline = directBaseline ?? (random() < baselineCalibration[String(baselineAutomatic)]);
      const candidate = directCandidate ?? (random() < candidateCalibration[String(candidateAutomatic)]);
      counts[Number(baseline) * 2 + Number(candidate)] += 1;
    }

    const outcomeProbabilities = dirichletSample(counts.map((count) => count + 0.5), random);
    draws[iteration] = outcomeProbabilities[1] - outcomeProbabilities[2];
  }
  return summarizeDraws(draws, options.minEffect);
}

function machineNaiveDifference(pairs) {
  const machinePairs = pairs.filter(
    (pair) => automaticSuccess(pair.baseline) !== null && automaticSuccess(pair.candidate) !== null,
  );
  if (machinePairs.length === 0) return { pairs: 0, difference: null };
  const counts = pairedOutcomeCounts(
    machinePairs,
    (pair) => automaticSuccess(pair.baseline),
    (pair) => automaticSuccess(pair.candidate),
  );
  return { pairs: machinePairs.length, difference: observedDifference(counts) };
}

export function comparePolicies(records, {
  baseline,
  candidate,
  calibrate = false,
  threshold = 0.95,
  minEffect = 0,
  minimumCalibrationLabels = 10,
  iterations = 20000,
  seed = 20260811,
} = {}) {
  if (!(threshold > 0.5 && threshold < 1)) {
    throw new UserError("Decision threshold must be greater than 0.5 and less than 1");
  }
  if (!(iterations >= 1000 && Number.isInteger(iterations))) {
    throw new UserError("Iterations must be an integer of at least 1000");
  }
  const common = { baseline, candidate, threshold, minEffect, iterations, seed };

  if (!calibrate) {
    const pairs = matchedPairs(records, baseline, candidate, humanSuccess);
    if (pairs.length === 0) {
      throw new UserError(`No matched human-success evidence for ${baseline} versus ${candidate}`);
    }
    const counts = pairedOutcomeCounts(
      pairs,
      (pair) => pair.baseline_value,
      (pair) => pair.candidate_value,
    );
    const posterior = pairedPosterior(counts, { iterations, seed, minEffect });
    const decision = decide(posterior.probability_greater, posterior.probability_less, threshold);
    return {
      ...common,
      mode: "matched_human",
      matched_pairs: pairs.length,
      observed_difference: observedDifference(counts),
      judge_correction: null,
      ...posterior,
      decision,
      planner: planEvidence({ decision, pairs, meanDifference: posterior.mean }),
      calibration: null,
    };
  }

  const baselineCalibration = assertCalibrationSupport(records, baseline, minimumCalibrationLabels);
  const candidateCalibration = assertCalibrationSupport(records, candidate, minimumCalibrationLabels);
  const pairs = matchedPairs(records, baseline, candidate, (record) => humanSuccess(record) ?? automaticSuccess(record));
  if (pairs.length === 0) {
    throw new UserError(`No matched human-or-machine evidence for ${baseline} versus ${candidate}`);
  }
  const posterior = calibratedPosterior(
    pairs,
    { baseline: baselineCalibration, candidate: candidateCalibration },
    { iterations, seed, minEffect },
  );
  const naive = machineNaiveDifference(pairs);
  const decision = decide(posterior.probability_greater, posterior.probability_less, threshold);
  return {
    ...common,
    mode: "judge_calibrated",
    matched_pairs: pairs.length,
    observed_difference: naive.difference,
    observed_machine_pairs: naive.pairs,
    judge_correction: naive.difference === null ? null : posterior.mean - naive.difference,
    ...posterior,
    decision,
    planner: planEvidence({ decision, pairs, meanDifference: posterior.mean }),
    calibration: {
      baseline: baselineCalibration.summary,
      candidate: candidateCalibration.summary,
    },
  };
}
