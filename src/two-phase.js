import { UserError } from "./errors.js";
import { createRandom } from "./random.js";

// Two-phase (double) sampling for judge error rates.
//
// Phase 1 observes a cheap machine verdict and the existing reference verdict for
// every item. Phase 2 observes an expensive adjudicated gold label for a sampled
// subset. Estimating P(gold failure | machine success) from a disagreement-only
// subset is verification bias: the agreement strata carry an unknown gold error
// rate and get weight zero, so the estimand is not identified. This module
// stratifies on the full machine-by-reference frame, records the per-stratum
// sampling probability, and reweights by its inverse (Horvitz-Thompson), with a
// finite-population correction on the variance. It refuses to report a rate when
// any nonempty stratum was never sampled.

const Z95 = 1.959963984540054;

const STRATA = [
  { stratum: "machine_success_reference_success", machine_success: true, reference_success: true },
  { stratum: "machine_success_reference_failure", machine_success: true, reference_success: false },
  { stratum: "machine_failure_reference_success", machine_success: false, reference_success: true },
  { stratum: "machine_failure_reference_failure", machine_success: false, reference_success: false },
];

function requireBoolean(value, label, itemId) {
  if (typeof value !== "boolean") {
    throw new UserError(`Item ${itemId} has a missing or non-boolean ${label}`);
  }
  return value;
}

export function stratifyPhaseOne(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new UserError("Two-phase stratification requires a nonempty phase-one frame");
  }
  const buckets = new Map(STRATA.map((definition) => [definition.stratum, []]));
  const seen = new Set();
  for (const item of items) {
    const id = item?.item_id;
    if (typeof id !== "string" || id === "") throw new UserError("Phase-one frame contains an item without item_id");
    if (seen.has(id)) throw new UserError(`Phase-one frame contains a duplicate item_id: ${id}`);
    seen.add(id);
    const machine = requireBoolean(item.machine_success, "machine_success", id);
    const reference = requireBoolean(item.reference_success, "reference_success", id);
    const name = `machine_${machine ? "success" : "failure"}_reference_${reference ? "success" : "failure"}`;
    buckets.get(name).push(id);
  }
  return STRATA.map((definition) => {
    const ids = buckets.get(definition.stratum).slice().sort();
    return {
      ...definition,
      agreement: definition.machine_success === definition.reference_success,
      population: ids.length,
      item_ids: ids,
    };
  });
}

function shuffled(ids, seed) {
  const result = [...ids];
  const random = createRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

// Proportional allocation with at least one unit in every nonempty stratum, so
// no stratum can silently drop to sampling probability zero.
function allocate(strata, totalBudget) {
  const active = strata.filter((stratum) => stratum.population > 0);
  const capacity = active.reduce((sum, stratum) => sum + stratum.population, 0);
  if (totalBudget > capacity) {
    throw new UserError(`Two-phase budget ${totalBudget} exceeds the ${capacity} available items`);
  }
  if (totalBudget < active.length) {
    throw new UserError(
      `Two-phase budget ${totalBudget} cannot cover all ${active.length} nonempty strata; ` +
      "every nonempty stratum needs at least one adjudicated item for the rate to be identifiable",
    );
  }
  const counts = new Map(active.map((stratum) => [
    stratum.stratum,
    Math.min(stratum.population, Math.max(1, Math.round(totalBudget * stratum.population / capacity))),
  ]));
  const total = () => [...counts.values()].reduce((sum, value) => sum + value, 0);

  // Deterministic repair to land on the exact budget.
  const byShare = [...active].sort((left, right) =>
    right.population - left.population || left.stratum.localeCompare(right.stratum));
  while (total() > totalBudget) {
    const target = byShare.find((stratum) => counts.get(stratum.stratum) > 1);
    if (!target) break;
    counts.set(target.stratum, counts.get(target.stratum) - 1);
  }
  while (total() < totalBudget) {
    const target = byShare.find((stratum) => counts.get(stratum.stratum) < stratum.population);
    if (!target) break;
    counts.set(target.stratum, counts.get(target.stratum) + 1);
  }
  return counts;
}

export function allocateTwoPhaseSample({ strata, totalBudget, seed }) {
  if (!Number.isInteger(totalBudget) || totalBudget <= 0) {
    throw new UserError("Two-phase budget must be a positive integer");
  }
  if (!Number.isInteger(seed)) throw new UserError("Two-phase sampling seed must be an integer");
  const counts = allocate(strata, totalBudget);

  const selected = [];
  const planned = strata.map((stratum, index) => {
    const sampled = counts.get(stratum.stratum) ?? 0;
    const picks = shuffled(stratum.item_ids, seed + index + 1).slice(0, sampled).sort();
    for (const id of picks) selected.push({ item_id: id, stratum: stratum.stratum });
    return {
      stratum: stratum.stratum,
      agreement: stratum.agreement,
      machine_success: stratum.machine_success,
      reference_success: stratum.reference_success,
      population: stratum.population,
      sampled,
      sampling_probability: stratum.population === 0 ? null : sampled / stratum.population,
    };
  });
  return { total_budget: totalBudget, seed, strata: planned, selected };
}

// Horvitz-Thompson rate over one machine-verdict arm, with the SRSWOR
// finite-population correction. The denominator is a known phase-one count, so
// only the numerator carries sampling variance.
function armRate({ strata, observed, machineSuccess, goldSuccessTarget }) {
  const arm = strata.filter((stratum) => stratum.machine_success === machineSuccess && stratum.population > 0);
  const denominator = arm.reduce((sum, stratum) => sum + stratum.population, 0);
  if (denominator === 0) {
    return { estimate: null, standard_error: null, interval95: { low: null, high: null }, denominator: 0, strata: [] };
  }
  const missing = arm.filter((stratum) => (observed.get(stratum.stratum) ?? []).length === 0);
  if (missing.length > 0) {
    return {
      estimate: null,
      standard_error: null,
      interval95: { low: null, high: null },
      denominator,
      unsampled_strata: missing.map((stratum) => stratum.stratum),
      strata: [],
    };
  }

  let weightedTotal = 0;
  let variance = 0;
  const detail = [];
  for (const stratum of arm) {
    const labels = observed.get(stratum.stratum);
    const n = labels.length;
    const N = stratum.population;
    const hits = labels.filter((gold) => gold === goldSuccessTarget).length;
    const p = hits / n;
    weightedTotal += N * p;
    const fpc = n >= N ? 0 : 1 - n / N;
    const cellVariance = fpc * (p * (1 - p)) / Math.max(1, n - 1);
    variance += N ** 2 * cellVariance;
    detail.push({
      stratum: stratum.stratum,
      population: N,
      adjudicated: n,
      sampling_probability: n / N,
      gold_rate_in_stratum: p,
    });
  }
  const estimate = weightedTotal / denominator;
  const standardError = Math.sqrt(variance) / denominator;
  return {
    estimate,
    standard_error: standardError,
    interval95: {
      low: Math.max(0, estimate - Z95 * standardError),
      high: Math.min(1, estimate + Z95 * standardError),
    },
    denominator,
    strata: detail,
  };
}

export function ipwErrorRates({ items, strata, adjudicated, sampled }) {
  const frame = new Map();
  for (const stratum of strata) {
    for (const id of stratum.item_ids) frame.set(id, stratum.stratum);
  }
  const sampledSet = new Set(sampled ?? []);
  const observed = new Map(strata.map((stratum) => [stratum.stratum, []]));

  const seen = new Set();
  for (const row of adjudicated) {
    const id = row?.item_id;
    const stratum = frame.get(id);
    if (!stratum) throw new UserError(`Adjudicated gold label refers to an item outside the phase-one frame: ${id}`);
    if (!sampledSet.has(id)) throw new UserError(`Adjudicated gold label for an item that was not sampled: ${id}`);
    if (seen.has(id)) throw new UserError(`Duplicate adjudicated gold label: ${id}`);
    seen.add(id);
    observed.get(stratum).push(requireBoolean(row.gold_success, "gold_success", id));
  }
  const unlabelled = [...sampledSet].filter((id) => !seen.has(id));
  if (unlabelled.length > 0) {
    throw new UserError(
      `${unlabelled.length} sampled item(s) have no adjudicated gold label; ` +
      `adjudication must be complete before estimation (first: ${unlabelled.sort()[0]})`,
    );
  }

  const unidentifiable = strata
    .filter((stratum) => stratum.population > 0 && (observed.get(stratum.stratum) ?? []).length === 0)
    .map((stratum) => stratum.stratum);

  const falsePositive = armRate({ strata, observed, machineSuccess: true, goldSuccessTarget: false });
  const falseNegative = armRate({ strata, observed, machineSuccess: false, goldSuccessTarget: true });
  const identifiable = falsePositive.estimate !== null && falseNegative.estimate !== null;

  return {
    estimator: "horvitz_thompson_two_phase",
    total_population: items.length,
    total_adjudicated: seen.size,
    identifiable,
    unidentifiable_strata: unidentifiable,
    reason: identifiable
      ? "every nonempty stratum contributed at least one adjudicated gold label"
      : `nonempty stratum/strata never sampled, so the gold rate there is unknown and cannot be reweighted: ${unidentifiable.join(", ")}`,
    false_positive_rate: falsePositive,
    false_negative_rate: falseNegative,
    strata: strata.map((stratum) => ({
      stratum: stratum.stratum,
      agreement: stratum.agreement,
      population: stratum.population,
      adjudicated: (observed.get(stratum.stratum) ?? []).length,
      sampling_probability: stratum.population === 0
        ? null
        : (observed.get(stratum.stratum) ?? []).length / stratum.population,
    })),
  };
}
