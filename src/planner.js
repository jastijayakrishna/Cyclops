function sampleVariance(values) {
  if (values.length < 2) return 1;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

function chooseGroup(pairs, field) {
  const groups = new Map();
  for (const pair of pairs) {
    const name = pair.baseline[field] || "unknown";
    let values = groups.get(name);
    if (!values) {
      values = [];
      groups.set(name, values);
    }
    values.push(Number(pair.candidate_value) - Number(pair.baseline_value));
  }
  const candidates = [...groups.entries()]
    .filter(([, values]) => values.length >= 10)
    .map(([name, values]) => ({
      name,
      count: values.length,
      score: sampleVariance(values) / Math.sqrt(values.length),
    }))
    .sort((left, right) => right.score - left.score || right.count - left.count || left.name.localeCompare(right.name));
  return candidates[0] ?? null;
}

function ambiguousHumanLabels(pairs, limit = 7) {
  const candidates = [];
  for (const pair of pairs) {
    for (const record of [pair.baseline, pair.candidate]) {
      if (typeof record.human?.success === "boolean") continue;
      const judge = record.automatic_judge;
      if (!judge || (typeof judge.success !== "boolean" && typeof judge.score !== "number")) continue;
      const score = typeof judge.score === "number" ? judge.score : 0.5;
      candidates.push({
        trial_id: record.trial_id,
        policy: record.policy,
        task: record.task,
        site: record.site,
        ambiguity: 1 - 2 * Math.abs(score - 0.5),
      });
    }
  }
  return candidates
    .sort((left, right) => right.ambiguity - left.ambiguity || left.trial_id.localeCompare(right.trial_id))
    .slice(0, limit)
    .map(({ ambiguity: _ambiguity, ...candidate }) => candidate);
}

function estimatedRemainingPairs(pairs, effect) {
  if (pairs.length < 2 || Math.abs(effect) < 0.01) return null;
  const baselineRate = pairs.reduce((sum, pair) => sum + Number(pair.baseline_value), 0) / pairs.length;
  const candidateRate = pairs.reduce((sum, pair) => sum + Number(pair.candidate_value), 0) / pairs.length;
  const variance = baselineRate * (1 - baselineRate) + candidateRate * (1 - candidateRate);
  const totalNeeded = Math.ceil(1.96 ** 2 * Math.max(variance, 0.02) / effect ** 2);
  return Math.max(0, totalNeeded - pairs.length);
}

export function planEvidence({ decision, pairs, meanDifference }) {
  if (decision !== "INSUFFICIENT_EVIDENCE") {
    return { action: "STOP", reason: "decision_threshold_reached", human_labels: [], trials: null };
  }

  const labels = ambiguousHumanLabels(pairs);
  if (labels.length > 0) {
    return {
      action: "TEST",
      reason: "label_existing_machine_evidence_first",
      human_labels: labels,
      trials: null,
    };
  }

  const remaining = estimatedRemainingPairs(pairs, meanDifference);
  const task = chooseGroup(pairs, "task");
  const site = chooseGroup(pairs, "site");
  const batch = remaining === null ? 12 : Math.max(4, Math.min(25, remaining || 4));
  return {
    action: "TEST",
    planning_status: "heuristic_pending_cost_model_and_frozen_task_taxonomy",
    reason: remaining === null ? "effect_too_small_or_unstable_to_project" : "collect_next_bounded_batch",
    human_labels: [],
    trials: {
      matched_pairs: batch,
      estimated_remaining_pairs: remaining,
      task: task?.name ?? null,
      site: site?.name ?? null,
      policy_allocation: "run both policies under the same task/site condition",
    },
  };
}
