import { UserError } from "./errors.js";

// Endpoint machinery for the calibration experiment.
//
// A flip rate over a handful of policy pairs is almost always underpowered: with
// nine flippable pairs the exact interval spans most of the unit range, so no
// observed flip rate can distinguish "calibration matters" from "it does not".
// This module reports the flip rate with an exact Clopper-Pearson interval so the
// imprecision is visible rather than implied, and supplies a continuous primary
// endpoint (the posterior shift) that uses the magnitude of every pair instead of
// thresholding each one into a binary.

const Z95 = 1.959963984540054;
const UNDERPOWERED_WIDTH = 0.20;

function binomialPmf(k, n, p) {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  let coefficient = 1;
  for (let i = 0; i < k; i += 1) coefficient = coefficient * (n - i) / (i + 1);
  return coefficient * p ** k * (1 - p) ** (n - k);
}

function tailAtLeast(k, n, p) {
  let total = 0;
  for (let i = k; i <= n; i += 1) total += binomialPmf(i, n, p);
  return total;
}

function tailAtMost(k, n, p) {
  let total = 0;
  for (let i = 0; i <= k; i += 1) total += binomialPmf(i, n, p);
  return total;
}

function bisect(evaluate, target, increasing) {
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middle = (low + high) / 2;
    const value = evaluate(middle);
    if (increasing ? value < target : value > target) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export function clopperPearson(successes, total, alpha = 0.05) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 || successes < 0 || successes > total) {
    throw new UserError(`Invalid Clopper-Pearson input: ${successes}/${total}`);
  }
  const half = alpha / 2;
  const low = successes === 0 ? 0 : bisect((p) => tailAtLeast(successes, total, p), half, true);
  const high = successes === total ? 1 : bisect((p) => tailAtMost(successes, total, p), half, false);
  return { low, high };
}

// Rational approximation to the standard normal quantile (Acklam), adequate for
// sizing an experiment.
function normalQuantile(probability) {
  if (probability <= 0 || probability >= 1) throw new UserError(`Invalid probability: ${probability}`);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lower = 0.02425;
  if (probability < lower) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > 1 - lower) return -normalQuantile(1 - probability);
  const q = probability - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function requireProbability(value, field, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new UserError(`Pair ${label} has a missing or invalid ${field}`);
  }
  return value;
}

export function flipRateEndpoint({ pairs, alpha = 0.05 }) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new UserError("Flip-rate endpoint requires at least one pair");
  }
  const flipped = [];
  for (const pair of pairs) {
    const label = pair?.pair ?? "(unnamed)";
    if (typeof pair?.naive_decision !== "string" || typeof pair?.calibrated_decision !== "string") {
      throw new UserError(`Pair ${label} is missing naive_decision or calibrated_decision`);
    }
    if (pair.naive_decision !== pair.calibrated_decision) {
      flipped.push({ pair: label, from: pair.naive_decision, to: pair.calibrated_decision });
    }
  }
  const total = pairs.length;
  const flips = flipped.length;
  const interval = clopperPearson(flips, total, alpha);
  const width = interval.high - interval.low;
  const underpowered = width > UNDERPOWERED_WIDTH;
  return {
    endpoint: "decision_flip_rate",
    role: "secondary",
    total_pairs: total,
    flips,
    rate: flips / total,
    interval95: interval,
    interval_width: width,
    minimum_detectable_rate: minimumDetectableFlipRate({ pairs: total, alpha }),
    underpowered,
    interpretation: underpowered
      ? `A ${total}-pair flip rate cannot support a claim about how often calibration changes decisions: ` +
        `the exact 95% interval spans ${(width * 100).toFixed(0)} percentage points. Use the continuous endpoint as primary.`
      : `The exact 95% interval spans ${(width * 100).toFixed(1)} percentage points, narrow enough to interpret directly.`,
    flipped_pairs: flipped,
  };
}

export function continuousShiftEndpoint({ pairs, alpha = 0.05 }) {
  if (!Array.isArray(pairs) || pairs.length === 0) {
    throw new UserError("Continuous endpoint requires at least one pair");
  }
  const shifts = pairs.map((pair) => {
    const label = pair?.pair ?? "(unnamed)";
    const naive = requireProbability(pair?.naive_probability, "naive_probability", label);
    const calibrated = requireProbability(pair?.calibrated_probability, "calibrated_probability", label);
    return { pair: label, signed: calibrated - naive, absolute: Math.abs(calibrated - naive) };
  });
  const n = shifts.length;
  const absolute = shifts.map((shift) => shift.absolute);
  const mean = absolute.reduce((sum, value) => sum + value, 0) / n;
  const variance = n < 2
    ? 0
    : absolute.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const standardError = Math.sqrt(variance / n);
  const z = normalQuantile(1 - alpha / 2);
  return {
    endpoint: "mean_absolute_posterior_shift",
    role: "primary",
    pairs: n,
    mean_absolute_shift: mean,
    mean_signed_shift: shifts.reduce((sum, shift) => sum + shift.signed, 0) / n,
    max_absolute_shift: Math.max(...absolute),
    standard_error: standardError,
    interval95: {
      low: Math.max(0, mean - z * standardError),
      high: Math.min(1, mean + z * standardError),
    },
    per_pair: shifts,
  };
}

// Smallest true flip rate distinguishable from zero at the given power, from
// n·p² = (z_alpha/2 + z_beta)²·p(1-p).
export function minimumDetectableFlipRate({ pairs, alpha = 0.05, power = 0.8 }) {
  if (!Number.isInteger(pairs) || pairs <= 0) throw new UserError("Pairs must be a positive integer");
  const c = normalQuantile(1 - alpha / 2) + normalQuantile(power);
  return c ** 2 / (pairs + c ** 2);
}

export const POWER_CONSTANTS = { Z95, UNDERPOWERED_WIDTH };
