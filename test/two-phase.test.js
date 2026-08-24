import assert from "node:assert/strict";
import test from "node:test";
import { allocateTwoPhaseSample, ipwErrorRates, stratifyPhaseOne } from "../src/two-phase.js";
import { createRandom } from "../src/random.js";

// Phase-1 frame: machine verdict and reference verdict are known for every item.
// Phase-2 gold label is observed only for sampled items.
function population({ size, seed = 7, goldGivenCell }) {
  const random = createRandom(seed);
  const items = [];
  for (let index = 0; index < size; index += 1) {
    const machine = random() < 0.45;
    const reference = random() < 0.4;
    const cell = `${machine ? "m1" : "m0"}_${reference ? "r1" : "r0"}`;
    items.push({
      item_id: `item-${index}`,
      machine_success: machine,
      reference_success: reference,
      gold_success: random() < goldGivenCell[cell],
    });
  }
  return items;
}

function trueRate(items, { machine, gold }) {
  const denominator = items.filter((item) => item.machine_success === machine);
  if (denominator.length === 0) return null;
  return denominator.filter((item) => item.gold_success === gold).length / denominator.length;
}

test("stratifies the phase-one frame into the four machine-by-reference cells", () => {
  const items = [
    { item_id: "a", machine_success: true, reference_success: true },
    { item_id: "b", machine_success: true, reference_success: false },
    { item_id: "c", machine_success: false, reference_success: true },
    { item_id: "d", machine_success: false, reference_success: false },
    { item_id: "e", machine_success: true, reference_success: false },
  ];
  const strata = stratifyPhaseOne(items);
  assert.equal(strata.length, 4);
  const byName = new Map(strata.map((stratum) => [stratum.stratum, stratum]));
  assert.equal(byName.get("machine_success_reference_success").population, 1);
  assert.equal(byName.get("machine_success_reference_failure").population, 2);
  assert.equal(byName.get("machine_failure_reference_success").population, 1);
  assert.equal(byName.get("machine_failure_reference_failure").population, 1);
  assert.equal(byName.get("machine_success_reference_failure").agreement, false);
  assert.equal(byName.get("machine_success_reference_success").agreement, true);
});

test("census adjudication reproduces the naive gold rate exactly", () => {
  const items = population({
    size: 400,
    goldGivenCell: { m1_r1: 0.9, m1_r0: 0.5, m0_r1: 0.4, m0_r0: 0.05 },
  });
  const strata = stratifyPhaseOne(items);
  const adjudicated = items.map((item) => ({ item_id: item.item_id, gold_success: item.gold_success }));
  const result = ipwErrorRates({ items, strata, adjudicated, sampled: items.map((item) => item.item_id) });

  assert.equal(result.identifiable, true);
  assert.ok(Math.abs(result.false_positive_rate.estimate - trueRate(items, { machine: true, gold: false })) < 1e-12);
  assert.ok(Math.abs(result.false_negative_rate.estimate - trueRate(items, { machine: false, gold: true })) < 1e-12);
  // A census leaves no sampling uncertainty.
  assert.ok(result.false_positive_rate.standard_error < 1e-12);
});

test("refuses to estimate when a nonempty stratum was never sampled", () => {
  const items = population({
    size: 200,
    goldGivenCell: { m1_r1: 0.9, m1_r0: 0.5, m0_r1: 0.4, m0_r0: 0.05 },
  });
  const strata = stratifyPhaseOne(items);
  // Disagreement-only adjudication: the two agreement cells are never sampled.
  const disagreementOnly = items.filter((item) => item.machine_success !== item.reference_success);
  const adjudicated = disagreementOnly.map((item) => ({ item_id: item.item_id, gold_success: item.gold_success }));

  const result = ipwErrorRates({
    items,
    strata,
    adjudicated,
    sampled: disagreementOnly.map((item) => item.item_id),
  });

  assert.equal(result.identifiable, false);
  assert.equal(result.false_positive_rate.estimate, null);
  assert.equal(result.false_negative_rate.estimate, null);
  assert.deepEqual(
    result.unidentifiable_strata.sort(),
    ["machine_failure_reference_failure", "machine_success_reference_success"],
  );
  assert.match(result.reason, /never sampled/u);
});

test("inverse-probability weighting recovers the true rate that disagreement-only sampling misses", () => {
  const goldGivenCell = { m1_r1: 0.95, m1_r0: 0.35, m0_r1: 0.45, m0_r0: 0.04 };
  const items = population({ size: 3000, seed: 11, goldGivenCell });
  const strata = stratifyPhaseOne(items);
  const truth = trueRate(items, { machine: true, gold: false });

  const plan = allocateTwoPhaseSample({ strata, totalBudget: 600, seed: 20260812 });
  const sampledIds = plan.selected.map((row) => row.item_id);
  const goldById = new Map(items.map((item) => [item.item_id, item.gold_success]));
  const adjudicated = sampledIds.map((id) => ({ item_id: id, gold_success: goldById.get(id) }));

  const result = ipwErrorRates({ items, strata, adjudicated, sampled: sampledIds });
  assert.equal(result.identifiable, true);

  // IPW is close to truth and the 95% interval covers it.
  assert.ok(
    Math.abs(result.false_positive_rate.estimate - truth) < 0.05,
    `IPW ${result.false_positive_rate.estimate} vs truth ${truth}`,
  );
  assert.ok(result.false_positive_rate.interval95.low <= truth);
  assert.ok(result.false_positive_rate.interval95.high >= truth);

  // The naive disagreement-only rate is badly biased for the same estimand,
  // which is why the unweighted design cannot be used.
  const disagreementOnly = items.filter((item) => item.machine_success !== item.reference_success);
  const naive = disagreementOnly.filter((item) => item.machine_success && !item.gold_success).length /
    disagreementOnly.filter((item) => item.machine_success).length;
  assert.ok(Math.abs(naive - truth) > 2 * Math.abs(result.false_positive_rate.estimate - truth));
});

test("allocates a bounded sample across every nonempty stratum", () => {
  const items = population({
    size: 1000,
    goldGivenCell: { m1_r1: 0.9, m1_r0: 0.5, m0_r1: 0.4, m0_r0: 0.05 },
  });
  const strata = stratifyPhaseOne(items);
  const plan = allocateTwoPhaseSample({ strata, totalBudget: 240, seed: 5 });

  assert.equal(plan.selected.length, 240);
  assert.equal(new Set(plan.selected.map((row) => row.item_id)).size, 240);
  for (const stratum of plan.strata) {
    assert.ok(stratum.sampled > 0, `stratum ${stratum.stratum} received no sample`);
    assert.ok(stratum.sampled <= stratum.population);
    assert.ok(Math.abs(stratum.sampling_probability - stratum.sampled / stratum.population) < 1e-12);
  }
});

test("allocation is deterministic for a fixed seed and changes with the seed", () => {
  const items = population({
    size: 500,
    goldGivenCell: { m1_r1: 0.9, m1_r0: 0.5, m0_r1: 0.4, m0_r0: 0.05 },
  });
  const strata = stratifyPhaseOne(items);
  const first = allocateTwoPhaseSample({ strata, totalBudget: 120, seed: 99 });
  const again = allocateTwoPhaseSample({ strata, totalBudget: 120, seed: 99 });
  const other = allocateTwoPhaseSample({ strata, totalBudget: 120, seed: 100 });

  assert.deepEqual(first.selected.map((r) => r.item_id), again.selected.map((r) => r.item_id));
  assert.notDeepEqual(first.selected.map((r) => r.item_id), other.selected.map((r) => r.item_id));
});

test("rejects a gold label for an item that was not in the sample", () => {
  const items = population({
    size: 100,
    goldGivenCell: { m1_r1: 0.9, m1_r0: 0.5, m0_r1: 0.4, m0_r0: 0.05 },
  });
  const strata = stratifyPhaseOne(items);
  assert.throws(
    () => ipwErrorRates({
      items,
      strata,
      adjudicated: [{ item_id: "item-0", gold_success: true }, { item_id: "ghost", gold_success: false }],
      sampled: ["item-0", "ghost"],
    }),
    /ghost/u,
  );
});
