import { UserError } from "./errors.js";

// Gold labels and the disagreement/error distinction.
//
// RoboArena reference labels are single-rater. Comparing a judge to them yields a
// disagreement rate, not an error rate: when the two differ, either one could be
// wrong, and the raw agreement number cannot separate judge error from reference
// noise. Calling a judge "23.5% false positive" against single-rater labels
// asserts the reference is infallible.
//
// This module builds gold labels from at least two independent raters, refuses to
// invent a verdict when raters split, reports Fleiss' kappa so reference noise is
// visible, and names the measure honestly depending on whether gold labels exist.

const MINIMUM_RATERS = 2;

export function fleissKappa(itemCategoryCounts) {
  if (!Array.isArray(itemCategoryCounts) || itemCategoryCounts.length === 0) return null;
  const raters = itemCategoryCounts[0].reduce((sum, value) => sum + value, 0);
  if (raters < 2) return null;
  const categories = itemCategoryCounts[0].length;
  const items = itemCategoryCounts.length;
  const categoryTotals = new Array(categories).fill(0);
  let agreementSum = 0;
  for (const counts of itemCategoryCounts) {
    if (counts.reduce((sum, value) => sum + value, 0) !== raters) {
      throw new UserError("Fleiss kappa requires the same number of raters for every item");
    }
    counts.forEach((value, index) => { categoryTotals[index] += value; });
    agreementSum += (counts.reduce((sum, value) => sum + value ** 2, 0) - raters) / (raters * (raters - 1));
  }
  const observed = agreementSum / items;
  const expected = categoryTotals.reduce((sum, total) => sum + (total / (items * raters)) ** 2, 0);
  if (expected >= 1) return null;
  return (observed - expected) / (1 - expected);
}

export function adjudicateGoldLabels({ ratings, minimumRaters = MINIMUM_RATERS }) {
  if (!Array.isArray(ratings) || ratings.length === 0) {
    throw new UserError("Adjudication requires at least one rating");
  }
  const byItem = new Map();
  for (const rating of ratings) {
    const { item_id: itemId, rater_id: raterId, success } = rating ?? {};
    if (typeof itemId !== "string" || itemId === "") throw new UserError("Rating is missing item_id");
    if (typeof raterId !== "string" || raterId === "") throw new UserError(`Rating for ${itemId} is missing rater_id`);
    if (typeof success !== "boolean") throw new UserError(`Rating for ${itemId} by ${raterId} has a non-boolean success`);
    let bucket = byItem.get(itemId);
    if (!bucket) { bucket = new Map(); byItem.set(itemId, bucket); }
    if (bucket.has(raterId)) throw new UserError(`Rater ${raterId} rated item ${itemId} more than once`);
    bucket.set(raterId, success);
  }

  const counts = [...byItem.values()].map((bucket) => bucket.size);
  const raterCount = counts[0];
  if (counts.some((value) => value !== raterCount)) {
    throw new UserError("Adjudication requires the same number of raters for every item");
  }

  const items = [...byItem.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([itemId, bucket]) => {
    const votes = [...bucket.values()];
    const successes = votes.filter(Boolean).length;
    const failures = votes.length - successes;
    const resolved = successes !== failures;
    return {
      item_id: itemId,
      raters: votes.length,
      votes: { success: successes, failure: failures },
      unanimous: successes === 0 || failures === 0,
      resolved,
      gold_success: raterCount < minimumRaters || !resolved ? null : successes > failures,
      rater_verdicts: Object.fromEntries([...bucket.entries()].sort(([l], [r]) => l.localeCompare(r))),
    };
  });

  const unresolved = items.filter((item) => !item.resolved).map((item) => item.item_id);
  const kappa = raterCount >= 2
    ? fleissKappa(items.map((item) => [item.votes.success, item.votes.failure]))
    : null;

  let usable = true;
  let reason = `${items.length} item(s) adjudicated by ${raterCount} independent raters with no unresolved splits`;
  if (raterCount < minimumRaters) {
    usable = false;
    reason = `Gold labels need at least ${minimumRaters} independent raters per item; found ${raterCount}. ` +
      "A single rater's verdict is another opinion, not ground truth.";
  } else if (unresolved.length > 0) {
    usable = false;
    reason = `${unresolved.length} item(s) are unresolved ties and need a tie-breaking rater before use as gold labels`;
  }

  return {
    usable_as_gold: usable,
    reason,
    raters_per_item: raterCount,
    minimum_raters: minimumRaters,
    items,
    unresolved,
    reliability: {
      fleiss_kappa: kappa,
      unanimous_items: items.filter((item) => item.unanimous).length,
      unanimity_rate: items.filter((item) => item.unanimous).length / items.length,
    },
  };
}

export function measureAgainstReference({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new UserError("Reference comparison requires at least one item");
  }
  let machineSuccessReferenceFailure = 0;
  let machineFailureReferenceSuccess = 0;
  let agreements = 0;
  let machineSuccess = 0;
  let machineFailure = 0;
  let withGold = 0;
  let goldFalsePositive = 0;
  let goldFalseNegative = 0;

  for (const item of items) {
    const machine = item?.machine_success;
    const reference = item?.reference_success;
    if (typeof machine !== "boolean" || typeof reference !== "boolean") {
      throw new UserError(`Item ${item?.item_id} needs boolean machine_success and reference_success`);
    }
    if (machine) machineSuccess += 1; else machineFailure += 1;
    if (machine === reference) agreements += 1;
    if (machine && !reference) machineSuccessReferenceFailure += 1;
    if (!machine && reference) machineFailureReferenceSuccess += 1;
    if (typeof item.gold_success === "boolean") {
      withGold += 1;
      if (machine && !item.gold_success) goldFalsePositive += 1;
      if (!machine && item.gold_success) goldFalseNegative += 1;
    }
  }

  const base = {
    total: items.length,
    raw_agreement: agreements / items.length,
    machine_success_reference_failure_rate: machineSuccess === 0 ? null : machineSuccessReferenceFailure / machineSuccess,
    machine_failure_reference_success_rate: machineFailure === 0 ? null : machineFailureReferenceSuccess / machineFailure,
  };

  if (withGold === items.length) {
    return {
      ...base,
      measure: "judge_error",
      judge_error_identifiable: true,
      reason: `All ${items.length} item(s) carry an adjudicated gold label, so machine error is identified against gold rather than against single-rater reference labels`,
      gold_coverage: 1,
      false_positive_rate: machineSuccess === 0 ? null : goldFalsePositive / machineSuccess,
      false_negative_rate: machineFailure === 0 ? null : goldFalseNegative / machineFailure,
    };
  }

  return {
    ...base,
    measure: "reference_disagreement",
    judge_error_identifiable: false,
    gold_coverage: withGold / items.length,
    reason: withGold === 0
      ? "No adjudicated gold labels supplied. RoboArena reference labels are single-rater and are not ground truth, " +
        "so these are disagreement rates: a disagreement does not say which side is wrong."
      : `Gold labels cover only ${withGold} of ${items.length} item(s), an incomplete set. ` +
        "Mixing gold and single-rater reference labels would silently redefine the estimand, so no judge error rate is reported.",
  };
}
