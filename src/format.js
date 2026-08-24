function percent(value, digits = 1) {
  return value === null || value === undefined ? "N/A" : `${(value * 100).toFixed(digits)}%`;
}

function line(label, value) {
  return `${label.padEnd(32)}${value}`;
}

export function formatComparison(result) {
  const lines = [
    "POLICY COMPARISON",
    "",
    line("Baseline", result.baseline),
    line("Candidate", result.candidate),
    line("Evidence mode", result.mode),
    line("Matched comparisons", String(result.matched_pairs)),
    "",
    line("Observed difference", percent(result.observed_difference)),
    line("Judge correction", percent(result.judge_correction)),
    line("Estimated true improvement", percent(result.mean)),
    line("95% credible interval", `[${percent(result.interval95[0])}, ${percent(result.interval95[1])}]`),
    line(
      result.minEffect === 0 ? "P(candidate > baseline)" : `P(improvement > ${percent(result.minEffect)})`,
      percent(result.probability_greater),
    ),
    line(
      result.minEffect === 0 ? "P(baseline > candidate)" : `P(improvement < -${percent(result.minEffect)})`,
      percent(result.probability_less),
    ),
    "",
    "DECISION",
    result.decision.replaceAll("_", " "),
    "",
  ];
  if (result.planner.action === "STOP") {
    lines.push("STOP TESTING");
  } else if (result.planner.human_labels.length > 0) {
    lines.push("Recommended next evidence:", "", `${result.planner.human_labels.length} human labels`);
    for (const item of result.planner.human_labels) {
      lines.push(`  ${item.trial_id} | ${item.policy} | ${item.task}`);
    }
  } else {
    const trials = result.planner.trials;
    lines.push(
      "Exploratory next batch (cost model not yet supplied):",
      "",
      `${trials.matched_pairs} matched policy-pair trials`,
      `Task: ${trials.task ?? "sample from the frozen target task distribution"}`,
      `Site: ${trials.site ?? "sample from the frozen target site distribution"}`,
    );
    if (trials.estimated_remaining_pairs !== null) {
      lines.push(`Estimated additional pairs at current effect: ${trials.estimated_remaining_pairs}`);
    } else {
      lines.push("Total evidence required cannot be projected reliably at the current effect.");
    }
  }
  return lines.join("\n");
}

export function formatAudit(audit) {
  const lines = ["AUTOMATIC JUDGE AUDIT", ""];
  const append = (label, item) => {
    lines.push(
      label,
      line("Paired labels", String(item.paired_labels)),
      line(
        "False-positive rate",
        `${percent(item.false_positive_rate.rate)} (${item.false_positive_rate.numerator}/${item.false_positive_rate.denominator})`,
      ),
      line(
        "False-negative rate",
        `${percent(item.false_negative_rate.rate)} (${item.false_negative_rate.numerator}/${item.false_negative_rate.denominator})`,
      ),
      "",
    );
  };
  append("Overall", audit.overall);
  for (const [field, items] of Object.entries(audit.groups)) {
    lines.push(`By ${field}`);
    for (const item of items) append(`  ${item.name}`, item);
  }
  return lines.join("\n").trimEnd();
}
