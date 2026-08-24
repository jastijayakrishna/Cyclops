import { UserError } from "./errors.js";
import { automaticSuccess, humanSuccess } from "./evidence.js";
import { wilsonInterval } from "./statistics.js";

const SUPPORTED_GROUPS = new Set(["policy", "task", "site"]);

function emptyConfusion() {
  return { true_positive: 0, false_positive: 0, false_negative: 0, true_negative: 0 };
}

function addObservation(confusion, automatic, human) {
  if (automatic && human) confusion.true_positive += 1;
  else if (automatic && !human) confusion.false_positive += 1;
  else if (!automatic && human) confusion.false_negative += 1;
  else confusion.true_negative += 1;
}

function summarize(name, confusion) {
  const humanFailures = confusion.false_positive + confusion.true_negative;
  const humanSuccesses = confusion.false_negative + confusion.true_positive;
  const total = humanFailures + humanSuccesses;
  return {
    name,
    paired_labels: total,
    confusion,
    false_positive_rate: {
      numerator: confusion.false_positive,
      denominator: humanFailures,
      rate: humanFailures ? confusion.false_positive / humanFailures : null,
      interval95: wilsonInterval(confusion.false_positive, humanFailures),
    },
    false_negative_rate: {
      numerator: confusion.false_negative,
      denominator: humanSuccesses,
      rate: humanSuccesses ? confusion.false_negative / humanSuccesses : null,
      interval95: wilsonInterval(confusion.false_negative, humanSuccesses),
    },
  };
}

export function auditJudge(records, groupBy = ["policy"]) {
  for (const group of groupBy) {
    if (!SUPPORTED_GROUPS.has(group)) {
      throw new UserError(`Unsupported audit grouping ${group}; choose policy, task, or site`);
    }
  }
  const paired = records.filter(
    (record) => automaticSuccess(record) !== null && humanSuccess(record) !== null,
  );
  if (paired.length === 0) {
    throw new UserError(
      "No paired automatic-judge/human labels are available; judge bias cannot be audited from this evidence.",
    );
  }

  const overall = emptyConfusion();
  for (const record of paired) addObservation(overall, automaticSuccess(record), humanSuccess(record));
  const groups = {};
  for (const field of groupBy) {
    const values = new Map();
    for (const record of paired) {
      const key = String(record[field] ?? "unknown");
      let confusion = values.get(key);
      if (!confusion) {
        confusion = emptyConfusion();
        values.set(key, confusion);
      }
      addObservation(confusion, automaticSuccess(record), humanSuccess(record));
    }
    groups[field] = [...values.entries()]
      .map(([name, confusion]) => summarize(name, confusion))
      .sort((left, right) => right.paired_labels - left.paired_labels || left.name.localeCompare(right.name));
  }
  return { overall: summarize("overall", overall), groups };
}

