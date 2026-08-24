import { betaSample, createRandom, dirichletSample } from "./random.js";

export function quantile(sortedValues, probability) {
  if (sortedValues.length === 0) return Number.NaN;
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

export function summarizeDraws(draws, minEffect = 0) {
  const sorted = [...draws].sort((left, right) => left - right);
  return {
    mean: draws.reduce((sum, value) => sum + value, 0) / draws.length,
    interval95: [quantile(sorted, 0.025), quantile(sorted, 0.975)],
    probability_greater: draws.filter((value) => value > minEffect).length / draws.length,
    probability_less: draws.filter((value) => value < -minEffect).length / draws.length,
  };
}

export function pairedOutcomeCounts(pairs, baselineSelector, candidateSelector) {
  const counts = [0, 0, 0, 0];
  for (const pair of pairs) {
    const baseline = Number(Boolean(baselineSelector(pair)));
    const candidate = Number(Boolean(candidateSelector(pair)));
    const index = baseline * 2 + candidate;
    counts[index] += 1;
  }
  return counts;
}

export function observedDifference(counts) {
  const total = counts.reduce((sum, value) => sum + value, 0);
  if (total === 0) return Number.NaN;
  // Index 1 is candidate-only success; index 2 is baseline-only success.
  return (counts[1] - counts[2]) / total;
}

export function pairedPosterior(counts, { iterations = 20000, seed = 20260811, minEffect = 0 } = {}) {
  const random = createRandom(seed);
  const draws = new Array(iterations);
  for (let index = 0; index < iterations; index += 1) {
    const probabilities = dirichletSample(counts.map((count) => count + 0.5), random);
    draws[index] = probabilities[1] - probabilities[2];
  }
  return summarizeDraws(draws, minEffect);
}

export function calibrationCells(records, policy) {
  const cells = {
    false: { human_success: 0, human_failure: 0 },
    true: { human_success: 0, human_failure: 0 },
  };
  for (const record of records) {
    if (record.policy !== policy) continue;
    const automatic = typeof record.automatic_judge?.success === "boolean"
      ? record.automatic_judge.success
      : typeof record.automatic_judge?.score === "number"
        ? record.automatic_judge.score >= 0.5
        : null;
    const human = typeof record.human?.success === "boolean" ? record.human.success : null;
    if (automatic === null || human === null) continue;
    const cell = cells[String(automatic)];
    if (human) cell.human_success += 1;
    else cell.human_failure += 1;
  }
  return cells;
}

export function sampleCalibration(cells, random) {
  return {
    false: betaSample(cells.false.human_success + 0.5, cells.false.human_failure + 0.5, random),
    true: betaSample(cells.true.human_success + 0.5, cells.true.human_failure + 0.5, random),
  };
}

export function wilsonInterval(numerator, denominator, z = 1.96) {
  if (denominator === 0) return null;
  const rate = numerator / denominator;
  const z2 = z * z;
  const center = (rate + z2 / (2 * denominator)) / (1 + z2 / denominator);
  const half = z * Math.sqrt(
    (rate * (1 - rate) / denominator + z2 / (4 * denominator ** 2)) /
    (1 + z2 / denominator) ** 2,
  );
  return [Math.max(0, center - half), Math.min(1, center + half)];
}
