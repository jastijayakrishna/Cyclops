import assert from "node:assert/strict";
import test from "node:test";
import { comparePreference, matchedPreferenceSessions } from "../src/preference.js";

// RoboArena stores one session-level `preference` naming the A or B slot, so the
// preference is only interpretable for the policies in those two slots, whatever
// else the session contains.
function session(id, entries, preference) {
  return entries.map(([label, policy, success]) => ({
    trial_id: `${id}:${label}`,
    comparison_id: id,
    policy,
    task: "t",
    site: "s",
    human: { success, score: success ? 1 : 0, source: "roboarena-evaluator" },
    session_preference: preference,
  }));
}

test("extracts the A and B slots and ignores the other slots in a larger session", () => {
  const records = [
    ...session("s1", [["A", "alpha", true], ["B", "beta", false], ["C", "gamma", true]], "A"),
  ];
  const found = matchedPreferenceSessions(records);
  assert.equal(found.length, 1);
  assert.equal(found[0].policy_a, "alpha");
  assert.equal(found[0].policy_b, "beta");
  assert.equal(found[0].preference, "A");
  assert.equal(found[0].success_a, true);
  assert.equal(found[0].success_b, false);
});

test("skips sessions without a preference, without both slots, or without human success", () => {
  const records = [
    ...session("no-pref", [["A", "alpha", true], ["B", "beta", false]], null),
    ...session("bad-pref", [["A", "alpha", true], ["B", "beta", false]], "MAYBE"),
    ...session("only-a", [["A", "alpha", true], ["C", "gamma", false]], "A"),
    ...session("good", [["A", "alpha", true], ["B", "beta", false]], "TIE"),
  ];
  const found = matchedPreferenceSessions(records);
  assert.deepEqual(found.map((row) => row.comparison_id), ["good"]);
});

test("a policy preferred in every session gets a posterior probability near one", () => {
  const records = Array.from({ length: 60 }, (_, index) =>
    session(`s${index}`, [["A", "alpha", false], ["B", "beta", false]], "B")).flat();
  const result = comparePreference(records, { baseline: "alpha", candidate: "beta", seed: 1 });

  assert.equal(result.matched_sessions, 60);
  assert.equal(result.counts.candidate_preferred, 60);
  assert.equal(result.counts.baseline_preferred, 0);
  assert.ok(result.probability_greater > 0.99);
  assert.equal(result.decision, "CANDIDATE_BETTER");
  assert.ok(result.observed_difference > 0.9);
});

test("orientation follows the requested baseline and candidate, not the slot letters", () => {
  const records = Array.from({ length: 40 }, (_, index) =>
    session(`s${index}`, [["A", "alpha", false], ["B", "beta", false]], "A")).flat();
  const forward = comparePreference(records, { baseline: "alpha", candidate: "beta", seed: 3 });
  const reversed = comparePreference(records, { baseline: "beta", candidate: "alpha", seed: 3 });

  assert.equal(forward.counts.baseline_preferred, 40);
  assert.equal(reversed.counts.candidate_preferred, 40);
  assert.ok(Math.abs(forward.observed_difference + reversed.observed_difference) < 1e-12);
  assert.equal(forward.decision, "BASELINE_BETTER");
  assert.equal(reversed.decision, "CANDIDATE_BETTER");
});

test("all ties leave the effect at zero and the decision undecided", () => {
  const records = Array.from({ length: 50 }, (_, index) =>
    session(`s${index}`, [["A", "alpha", true], ["B", "beta", true]], "TIE")).flat();
  const result = comparePreference(records, { baseline: "alpha", candidate: "beta", seed: 4 });

  assert.equal(result.counts.tie, 50);
  assert.equal(result.observed_difference, 0);
  assert.ok(Math.abs(result.probability_greater - 0.5) < 0.1);
  assert.equal(result.decision, "INSUFFICIENT_EVIDENCE");
});

test("ties widen the posterior rather than being dropped", () => {
  const decisive = Array.from({ length: 20 }, (_, i) =>
    session(`d${i}`, [["A", "alpha", false], ["B", "beta", false]], "B")).flat();
  const padded = [
    ...decisive,
    ...Array.from({ length: 200 }, (_, i) =>
      session(`t${i}`, [["A", "alpha", false], ["B", "beta", false]], "TIE")).flat(),
  ];
  const withoutTies = comparePreference(decisive, { baseline: "alpha", candidate: "beta", seed: 5 });
  const withTies = comparePreference(padded, { baseline: "alpha", candidate: "beta", seed: 5 });

  assert.ok(withTies.observed_difference < withoutTies.observed_difference);
  assert.equal(withTies.matched_sessions, 220);
});

test("is deterministic for a fixed seed", () => {
  const records = Array.from({ length: 30 }, (_, index) =>
    session(`s${index}`, [["A", "alpha", index % 3 === 0], ["B", "beta", index % 2 === 0]],
      index % 3 === 0 ? "A" : index % 3 === 1 ? "B" : "TIE")).flat();
  const first = comparePreference(records, { baseline: "alpha", candidate: "beta", seed: 77 });
  const again = comparePreference(records, { baseline: "alpha", candidate: "beta", seed: 77 });
  assert.equal(first.probability_greater, again.probability_greater);
  assert.deepEqual(first.interval95, again.interval95);
});

test("refuses a pair with no shared preference sessions", () => {
  const records = session("s1", [["A", "alpha", true], ["B", "beta", false]], "A");
  assert.throws(
    () => comparePreference(records, { baseline: "alpha", candidate: "gamma", seed: 1 }),
    /No matched preference evidence/u,
  );
});

test("reports the paired success outcome on the same sessions for a like-for-like contrast", () => {
  const records = [
    ...session("s1", [["A", "alpha", false], ["B", "beta", true]], "B"),
    ...session("s2", [["A", "alpha", true], ["B", "beta", false]], "A"),
    ...session("s3", [["A", "alpha", false], ["B", "beta", false]], "TIE"),
  ];
  const result = comparePreference(records, { baseline: "alpha", candidate: "beta", seed: 9 });
  assert.equal(result.matched_sessions, 3);
  assert.equal(result.success_counts.candidate_only, 1);
  assert.equal(result.success_counts.baseline_only, 1);
  assert.equal(result.success_counts.both_failure, 1);
});
