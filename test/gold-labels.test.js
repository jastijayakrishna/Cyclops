import assert from "node:assert/strict";
import test from "node:test";
import { adjudicateGoldLabels, fleissKappa, measureAgainstReference } from "../src/gold-labels.js";

test("refuses to call a single rater's verdict a gold label", () => {
  const ratings = [
    { item_id: "a", rater_id: "reviewer-1", success: true },
    { item_id: "b", rater_id: "reviewer-1", success: false },
  ];
  const result = adjudicateGoldLabels({ ratings });

  assert.equal(result.usable_as_gold, false);
  assert.match(result.reason, /at least 2 independent raters/u);
  for (const item of result.items) assert.equal(item.gold_success, null);
});

test("two unanimous raters produce a gold label", () => {
  const ratings = [
    { item_id: "a", rater_id: "r1", success: true },
    { item_id: "a", rater_id: "r2", success: true },
    { item_id: "b", rater_id: "r1", success: false },
    { item_id: "b", rater_id: "r2", success: false },
  ];
  const result = adjudicateGoldLabels({ ratings });

  assert.equal(result.usable_as_gold, true);
  assert.equal(result.items.find((item) => item.item_id === "a").gold_success, true);
  assert.equal(result.items.find((item) => item.item_id === "b").gold_success, false);
  assert.equal(result.unresolved.length, 0);
  assert.ok(Math.abs(result.reliability.fleiss_kappa - 1) < 1e-12);
});

test("a two-rater split is left unresolved instead of silently broken", () => {
  const ratings = [
    { item_id: "a", rater_id: "r1", success: true },
    { item_id: "a", rater_id: "r2", success: false },
    { item_id: "b", rater_id: "r1", success: true },
    { item_id: "b", rater_id: "r2", success: true },
  ];
  const result = adjudicateGoldLabels({ ratings });

  const split = result.items.find((item) => item.item_id === "a");
  assert.equal(split.gold_success, null);
  assert.equal(split.resolved, false);
  assert.deepEqual(result.unresolved, ["a"]);
  assert.equal(result.usable_as_gold, false);
  assert.match(result.reason, /unresolved/u);
});

test("three raters resolve by majority and record that it was not unanimous", () => {
  const ratings = [
    { item_id: "a", rater_id: "r1", success: true },
    { item_id: "a", rater_id: "r2", success: true },
    { item_id: "a", rater_id: "r3", success: false },
  ];
  const result = adjudicateGoldLabels({ ratings });
  const item = result.items[0];

  assert.equal(item.gold_success, true);
  assert.equal(item.resolved, true);
  assert.equal(item.unanimous, false);
  assert.equal(item.votes.success, 2);
  assert.equal(item.votes.failure, 1);
  assert.equal(result.usable_as_gold, true);
});

test("rejects a rater who labels the same item twice", () => {
  assert.throws(() => adjudicateGoldLabels({
    ratings: [
      { item_id: "a", rater_id: "r1", success: true },
      { item_id: "a", rater_id: "r1", success: false },
    ],
  }), /r1.*a|a.*r1/u);
});

test("rejects an unbalanced design where items have different rater counts", () => {
  assert.throws(() => adjudicateGoldLabels({
    ratings: [
      { item_id: "a", rater_id: "r1", success: true },
      { item_id: "a", rater_id: "r2", success: true },
      { item_id: "b", rater_id: "r1", success: false },
    ],
  }), /same number of raters/u);
});

test("Fleiss kappa is one for perfect agreement and minus one for systematic opposition", () => {
  assert.ok(Math.abs(fleissKappa([[2, 0], [0, 2]]) - 1) < 1e-12);
  assert.ok(Math.abs(fleissKappa([[1, 1], [1, 1], [1, 1], [1, 1]]) - -1) < 1e-12);
});

test("Fleiss kappa is null when every rating falls in one category", () => {
  assert.equal(fleissKappa([[2, 0], [2, 0]]), null);
});

test("machine-versus-reference without gold labels is named a disagreement, not an error rate", () => {
  const items = [
    { item_id: "a", machine_success: true, reference_success: false },
    { item_id: "b", machine_success: false, reference_success: false },
    { item_id: "c", machine_success: true, reference_success: true },
    { item_id: "d", machine_success: false, reference_success: true },
  ];
  const result = measureAgainstReference({ items });

  assert.equal(result.measure, "reference_disagreement");
  assert.equal(result.judge_error_identifiable, false);
  assert.match(result.reason, /not ground truth|single-rater/u);
  assert.equal(result.false_positive_rate, undefined);
  assert.ok(Math.abs(result.machine_success_reference_failure_rate - 0.5) < 1e-12);
  assert.equal(result.raw_agreement, 0.5);
});

test("gold labels upgrade the same comparison to a judge error rate", () => {
  const items = [
    { item_id: "a", machine_success: true, reference_success: false, gold_success: false },
    { item_id: "b", machine_success: false, reference_success: false, gold_success: false },
    { item_id: "c", machine_success: true, reference_success: true, gold_success: true },
    { item_id: "d", machine_success: false, reference_success: true, gold_success: true },
  ];
  const result = measureAgainstReference({ items });

  assert.equal(result.measure, "judge_error");
  assert.equal(result.judge_error_identifiable, true);
  assert.ok(Math.abs(result.false_positive_rate - 0.5) < 1e-12);
  assert.ok(Math.abs(result.false_negative_rate - 0.5) < 1e-12);
});

test("partial gold coverage does not silently mix gold and reference labels", () => {
  const items = [
    { item_id: "a", machine_success: true, reference_success: false, gold_success: false },
    { item_id: "b", machine_success: false, reference_success: false },
  ];
  const result = measureAgainstReference({ items });
  assert.equal(result.measure, "reference_disagreement");
  assert.equal(result.judge_error_identifiable, false);
  assert.match(result.reason, /1 of 2|incomplete/u);
});
