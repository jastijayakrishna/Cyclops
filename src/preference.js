import { UserError } from "./errors.js";
import { createRandom, dirichletSample } from "./random.js";
import { summarizeDraws } from "./statistics.js";

// Human A/B preference as a second, independent evaluation metric.
//
// RoboArena records one session-level `preference` naming the A or B slot. It is
// therefore interpretable only for the two policies in those slots, regardless of
// how many policies the session contains: a seven-policy session still yields
// exactly one preference comparison, not twenty-one.
//
// This gives a second human-derived metric over the same sessions as binary task
// success, so the two can be contrasted like-for-like without any new labels.

const VALID_PREFERENCE = new Set(["A", "B", "TIE"]);

function slotLabel(record) {
  const trialId = record?.trial_id;
  if (typeof trialId !== "string") return null;
  const index = trialId.lastIndexOf(":");
  return index === -1 ? null : trialId.slice(index + 1);
}

export function matchedPreferenceSessions(records) {
  const sessions = new Map();
  for (const record of records) {
    const id = record?.comparison_id;
    if (typeof id !== "string") continue;
    let bucket = sessions.get(id);
    if (!bucket) { bucket = []; sessions.set(id, bucket); }
    bucket.push(record);
  }

  const rows = [];
  for (const [id, bucket] of [...sessions.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const preference = bucket[0]?.session_preference;
    if (!VALID_PREFERENCE.has(preference)) continue;
    if (new Set(bucket.map((record) => record.session_preference)).size !== 1) {
      throw new UserError(`Session ${id} carries conflicting session_preference values`);
    }
    const a = bucket.find((record) => slotLabel(record) === "A");
    const b = bucket.find((record) => slotLabel(record) === "B");
    if (!a || !b) continue;
    if (typeof a.human?.success !== "boolean" || typeof b.human?.success !== "boolean") continue;
    rows.push({
      comparison_id: id,
      policy_a: a.policy,
      policy_b: b.policy,
      preference,
      success_a: a.human.success,
      success_b: b.human.success,
      task: a.task ?? null,
      site: a.site ?? null,
    });
  }
  return rows;
}

function decide(probabilityGreater, probabilityLess, threshold) {
  if (probabilityGreater >= threshold) return "CANDIDATE_BETTER";
  if (probabilityLess >= threshold) return "BASELINE_BETTER";
  return "INSUFFICIENT_EVIDENCE";
}

export function comparePreference(records, {
  baseline,
  candidate,
  threshold = 0.95,
  minEffect = 0,
  iterations = 20000,
  seed = 20260811,
} = {}) {
  if (!baseline || !candidate) throw new UserError("Preference comparison needs a baseline and a candidate");
  if (baseline === candidate) throw new UserError("Baseline and candidate must differ");

  const all = matchedPreferenceSessions(records);
  const matched = all.filter((row) =>
    (row.policy_a === baseline && row.policy_b === candidate) ||
    (row.policy_a === candidate && row.policy_b === baseline));
  if (matched.length === 0) {
    throw new UserError(`No matched preference evidence for ${baseline} versus ${candidate}`);
  }

  // Orient every session toward the requested candidate.
  let candidatePreferred = 0;
  let baselinePreferred = 0;
  let tie = 0;
  const successCounts = { both_success: 0, candidate_only: 0, baseline_only: 0, both_failure: 0 };
  for (const row of matched) {
    const candidateIsA = row.policy_a === candidate;
    const preferredPolicy = row.preference === "TIE"
      ? null
      : row.preference === "A" ? row.policy_a : row.policy_b;
    if (preferredPolicy === null) tie += 1;
    else if (preferredPolicy === candidate) candidatePreferred += 1;
    else baselinePreferred += 1;

    const candidateSuccess = candidateIsA ? row.success_a : row.success_b;
    const baselineSuccess = candidateIsA ? row.success_b : row.success_a;
    if (candidateSuccess && baselineSuccess) successCounts.both_success += 1;
    else if (candidateSuccess) successCounts.candidate_only += 1;
    else if (baselineSuccess) successCounts.baseline_only += 1;
    else successCounts.both_failure += 1;
  }

  const total = matched.length;
  const random = createRandom(seed);
  const draws = new Array(iterations);
  for (let index = 0; index < iterations; index += 1) {
    // Jeffreys-style prior over (candidate preferred, baseline preferred, tie).
    const probabilities = dirichletSample(
      [candidatePreferred + 0.5, baselinePreferred + 0.5, tie + 0.5],
      random,
    );
    draws[index] = probabilities[0] - probabilities[1];
  }
  const posterior = summarizeDraws(draws, minEffect);
  const decision = decide(posterior.probability_greater, posterior.probability_less, threshold);

  return {
    metric: "human_preference",
    baseline,
    candidate,
    threshold,
    minEffect,
    iterations,
    seed,
    matched_sessions: total,
    counts: {
      candidate_preferred: candidatePreferred,
      baseline_preferred: baselinePreferred,
      tie,
    },
    success_counts: successCounts,
    observed_difference: (candidatePreferred - baselinePreferred) / total,
    ...posterior,
    decision,
  };
}
