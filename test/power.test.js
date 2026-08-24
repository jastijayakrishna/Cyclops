import assert from "node:assert/strict";
import test from "node:test";
import {
  clopperPearson,
  continuousShiftEndpoint,
  flipRateEndpoint,
  minimumDetectableFlipRate,
} from "../src/power.js";

// Independent binomial tails, so the interval test does not lean on the
// implementation it is checking.
function binomialTailAtLeast(k, n, p) {
  let total = 0;
  for (let i = k; i <= n; i += 1) total += binomialPmf(i, n, p);
  return total;
}
function binomialTailAtMost(k, n, p) {
  let total = 0;
  for (let i = 0; i <= k; i += 1) total += binomialPmf(i, n, p);
  return total;
}
function binomialPmf(k, n, p) {
  let coefficient = 1;
  for (let i = 0; i < k; i += 1) coefficient = coefficient * (n - i) / (i + 1);
  return coefficient * p ** k * (1 - p) ** (n - k);
}

test("Clopper-Pearson bounds solve the defining binomial tail equations", () => {
  const { low, high } = clopperPearson(3, 9);
  assert.ok(Math.abs(binomialTailAtLeast(3, 9, low) - 0.025) < 1e-6, `low tail ${binomialTailAtLeast(3, 9, low)}`);
  assert.ok(Math.abs(binomialTailAtMost(3, 9, high) - 0.025) < 1e-6, `high tail ${binomialTailAtMost(3, 9, high)}`);
  assert.ok(low < 3 / 9 && 3 / 9 < high);
});

test("Clopper-Pearson pins the bounds at zero and one for degenerate counts", () => {
  assert.equal(clopperPearson(0, 12).low, 0);
  assert.ok(clopperPearson(0, 12).high > 0);
  assert.equal(clopperPearson(12, 12).high, 1);
  assert.ok(clopperPearson(12, 12).low < 1);
});

test("a nine-pair flip rate is reported as underpowered with an interval wider than half the range", () => {
  const pairs = Array.from({ length: 9 }, (_, index) => ({
    pair: `p${index}`,
    naive_decision: "INSUFFICIENT_EVIDENCE",
    calibrated_decision: index < 3 ? "CANDIDATE_BETTER" : "INSUFFICIENT_EVIDENCE",
    naive_probability: 0.9,
    calibrated_probability: index < 3 ? 0.97 : 0.9,
  }));
  const result = flipRateEndpoint({ pairs });

  assert.equal(result.total_pairs, 9);
  assert.equal(result.flips, 3);
  assert.ok(Math.abs(result.rate - 1 / 3) < 1e-12);
  assert.ok(result.interval95.high - result.interval95.low > 0.5);
  assert.equal(result.underpowered, true);
  assert.match(result.interpretation, /cannot support/iu);
});

test("flip rate stops being flagged as underpowered once the interval is narrow", () => {
  const pairs = Array.from({ length: 4000 }, (_, index) => ({
    pair: `p${index}`,
    naive_decision: "INSUFFICIENT_EVIDENCE",
    calibrated_decision: index % 3 === 0 ? "CANDIDATE_BETTER" : "INSUFFICIENT_EVIDENCE",
    naive_probability: 0.9,
    calibrated_probability: 0.9,
  }));
  const result = flipRateEndpoint({ pairs });
  assert.equal(result.underpowered, false);
  assert.ok(result.interval95.high - result.interval95.low < 0.05);
});

test("continuous endpoint averages the absolute posterior shift and keeps the signed mean", () => {
  const pairs = [
    { pair: "a", naive_probability: 0.80, calibrated_probability: 0.90 },
    { pair: "b", naive_probability: 0.60, calibrated_probability: 0.40 },
    { pair: "c", naive_probability: 0.50, calibrated_probability: 0.55 },
  ];
  const result = continuousShiftEndpoint({ pairs });

  assert.ok(Math.abs(result.mean_absolute_shift - (0.10 + 0.20 + 0.05) / 3) < 1e-12);
  assert.ok(Math.abs(result.mean_signed_shift - (0.10 - 0.20 + 0.05) / 3) < 1e-12);
  assert.equal(result.pairs, 3);
  assert.ok(Math.abs(result.max_absolute_shift - 0.20) < 1e-12);
});

test("continuous endpoint has zero standard error when every shift is identical", () => {
  const pairs = Array.from({ length: 5 }, (_, index) => ({
    pair: `p${index}`,
    naive_probability: 0.5,
    calibrated_probability: 0.6,
  }));
  const result = continuousShiftEndpoint({ pairs });
  assert.ok(Math.abs(result.mean_absolute_shift - 0.1) < 1e-12);
  assert.ok(result.standard_error < 1e-12);
});

test("continuous endpoint is more precise than the flip rate on the same pairs", () => {
  const pairs = Array.from({ length: 9 }, (_, index) => ({
    pair: `p${index}`,
    naive_decision: "INSUFFICIENT_EVIDENCE",
    calibrated_decision: index < 3 ? "CANDIDATE_BETTER" : "INSUFFICIENT_EVIDENCE",
    naive_probability: 0.90,
    calibrated_probability: index < 3 ? 0.97 : 0.91,
  }));
  const flip = flipRateEndpoint({ pairs });
  const continuous = continuousShiftEndpoint({ pairs });
  const flipWidth = flip.interval95.high - flip.interval95.low;
  const continuousWidth = continuous.interval95.high - continuous.interval95.low;
  assert.ok(continuousWidth < flipWidth, `continuous ${continuousWidth} vs flip ${flipWidth}`);
});

test("minimum detectable flip rate shrinks as pairs increase", () => {
  const small = minimumDetectableFlipRate({ pairs: 9 });
  const large = minimumDetectableFlipRate({ pairs: 900 });
  assert.ok(small > large);
  assert.ok(small > 0.3, `nine pairs should only detect a large flip rate, got ${small}`);
  assert.ok(large < 0.1);
});

test("rejects pairs missing the posterior probabilities the endpoint needs", () => {
  assert.throws(() => continuousShiftEndpoint({ pairs: [{ pair: "a", naive_probability: 0.5 }] }), /calibrated_probability/u);
  assert.throws(() => flipRateEndpoint({ pairs: [] }), /at least one pair/u);
});
