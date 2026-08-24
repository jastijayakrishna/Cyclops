import { writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { auditJudge } from "./audit.js";
import { comparePolicies } from "./compare.js";
import { UserError } from "./errors.js";
import { readEvidence } from "./evidence.js";
import { readJson, writeJsonAtomic } from "./json-files.js";
import { createRandom } from "./random.js";

async function readResults(filePath) {
  const text = await import("node:fs/promises").then(({ readFile }) => readFile(filePath, "utf8"));
  return text.split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function shuffled(values, seed) {
  const result = [...values];
  const random = createRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildEvidence(analysisItems, results) {
  const resultMap = new Map(results.map((result) => [result.item_id, result]));
  if (resultMap.size !== analysisItems.length) {
    throw new UserError(`Pilot analysis requires ${analysisItems.length} judge results; found ${resultMap.size}`);
  }
  return analysisItems.map((item) => {
    const judge = resultMap.get(item.item_id);
    if (!judge) throw new UserError(`Judge result missing for item ${item.item_id}`);
    return {
      schema_version: 1,
      trial_id: item.trial_id,
      comparison_id: item.comparison_id,
      policy: item.policy,
      task: item.task,
      site: item.site,
      timestamp: item.timestamp,
      automatic_judge: {
        score: judge.automatic_score,
        success: judge.success,
        model: judge.model_version ?? judge.model,
        confidence: judge.confidence,
        reason_code: judge.reason_code,
        evidence: judge.evidence,
        prompt_sha256: judge.prompt_sha256,
      },
      human: {
        score: item.human_score,
        success: item.human_success,
        source: "roboarena-evaluator",
      },
      video_paths: [],
      source: { dataset: "RoboArena/DataDump_07-17-2026 pilot", metadata_path: item.comparison_id },
    };
  });
}

function machineAsHuman(records) {
  return records.map((record) => ({
    ...record,
    human: {
      score: record.automatic_judge.score,
      success: record.automatic_judge.success,
      source: "automatic-judge-naive",
    },
  }));
}

function hiddenHuman(records, revealedComparisons) {
  return records.map((record) => ({
    ...record,
    human: revealedComparisons.has(record.comparison_id) ? record.human : null,
  }));
}

function labelEfficiency(records, protocol, fullHuman) {
  const comparisonIds = [...new Set(records.map((record) => record.comparison_id))].sort();
  const repetitions = protocol.analysis.subsample_repetitions;
  const fractions = protocol.analysis.label_fractions.filter((fraction) => fraction < 1);
  const summaries = [];
  for (const fraction of fractions) {
    const runs = [];
    let unsupportedRuns = 0;
    const labels = Math.max(1, Math.ceil(comparisonIds.length * fraction));
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const seed = protocol.seed + Math.round(fraction * 1000) * 1000 + repetition;
      const revealed = new Set(shuffled(comparisonIds, seed).slice(0, labels));
      try {
        const calibrated = comparePolicies(hiddenHuman(records, revealed), {
          baseline: protocol.baseline,
          candidate: protocol.candidate,
          calibrate: true,
          minimumCalibrationLabels: Math.min(10, labels),
          iterations: 2000,
          seed,
        });
        const effectError = Math.abs(calibrated.mean - fullHuman.mean);
        const probabilityError = Math.abs(calibrated.probability_greater - fullHuman.probability_greater);
        runs.push({
          effect_error: effectError,
          probability_error: probabilityError,
          ranking_agrees: Math.sign(calibrated.mean) === Math.sign(fullHuman.mean),
          decision_agrees: calibrated.decision === fullHuman.decision,
          reconstructs: effectError <= protocol.analysis.reconstruction_effect_tolerance &&
            probabilityError <= protocol.analysis.reconstruction_probability_tolerance,
        });
      } catch (error) {
        if (!(error instanceof UserError)) throw error;
        unsupportedRuns += 1;
      }
    }
    summaries.push({
      fraction,
      labeled_sessions: labels,
      valid_runs: runs.length,
      unsupported_runs: unsupportedRuns,
      reconstruction_rate: runs.length ? runs.filter((run) => run.reconstructs).length / runs.length : null,
      ranking_agreement_rate: runs.length ? runs.filter((run) => run.ranking_agrees).length / runs.length : null,
      decision_agreement_rate: runs.length ? runs.filter((run) => run.decision_agrees).length / runs.length : null,
      median_absolute_effect_error: median(runs.map((run) => run.effect_error)),
      median_absolute_probability_error: median(runs.map((run) => run.probability_error)),
    });
  }
  return summaries;
}

function policyRateGap(audit, field) {
  const rates = audit.groups.policy
    .map((group) => group[field].rate)
    .filter((rate) => rate !== null);
  return rates.length === 2 ? Math.abs(rates[0] - rates[1]) : null;
}

function percent(value, digits = 1) {
  return value === null ? "N/A" : `${(value * 100).toFixed(digits)}%`;
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim() !== ""))].sort();
}

function safeLeafName(value, label) {
  if (typeof value !== "string" || value.trim() === "" || value !== path.basename(value) || value === "." || value === "..") {
    throw new UserError(`${label} must be a file name inside the pilot directory`);
  }
  return value;
}

function safeOutputPrefix(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new UserError("Pilot output prefix must contain only letters, numbers, dots, underscores, and hyphens");
  }
  return value;
}

async function writeTextAtomic(filePath, text) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, text, { flag: "wx" });
  await rename(temporary, filePath);
}

function markdown(report) {
  const efficiency = report.label_efficiency.map((item) =>
    `| ${(item.fraction * 100).toFixed(0)}% | ${item.valid_runs}/${item.valid_runs + item.unsupported_runs} | ` +
    `${percent(item.reconstruction_rate)} | ${percent(item.median_absolute_effect_error)} | ` +
    `${percent(item.median_absolute_probability_error)} |`,
  ).join("\n");
  const models = report.judgments.model_versions.join(", ") || report.judgments.models.join(", ") || "unknown";
  const methods = report.judgments.review_methods.join(", ") || "unspecified";
  const substitution = report.judgments.mode === "manual_local_review"
    ? "\nThis is a user-directed local manual-review substitution for the frozen Gemini run. It measures review-versus-human distortion, not Gemini distortion.\n"
    : "";
  return `# Pilot judge result

Generated from the frozen protocol in \`protocol.json\`. This is exploratory evidence, not a confirmatory result.
${substitution}
- Result file: \`${report.judgments.result_file}\`
- Judge model/reviewer: ${models}
- Review method: ${methods}

## Outcomes

| Measure | Pilot judge | Full human labels |
|---|---:|---:|
| Matched sample sessions | ${report.sample.machine.matched_pairs} | ${report.sample.human.matched_pairs} |
| Candidate improvement | ${percent(report.sample.machine.mean)} | ${percent(report.sample.human.mean)} |
| 95% interval | [${percent(report.sample.machine.interval95[0])}, ${percent(report.sample.machine.interval95[1])}] | [${percent(report.sample.human.interval95[0])}, ${percent(report.sample.human.interval95[1])}] |
| P(candidate > baseline) | ${percent(report.sample.machine.probability_greater)} | ${percent(report.sample.human.probability_greater)} |
| Decision | ${report.sample.machine.decision} | ${report.sample.human.decision} |

- Human-minus-judge effect shift: ${percent(report.signals.human_minus_machine_effect_shift)}
- Posterior-probability shift: ${percent(report.signals.posterior_probability_shift)}
- Policy false-negative-rate gap: ${percent(report.signals.policy_false_negative_rate_gap)}
- Policy false-positive-rate gap: ${percent(report.signals.policy_false_positive_rate_gap)}
- Decision distortion: ${report.distortion.decision_changed ? "yes" : "no"} (${report.distortion.decision_distortion_rate}/1 policy pair)
- Ranking distortion: ${report.distortion.ranking_changed ? "yes" : "no"} (${report.distortion.ranking_distortion_rate}/1 policy pair)
- Exploratory gate: **${report.exploratory_gate}**

## Human-label efficiency

| Human labels | Valid runs | Reconstruction rate | Median effect error | Median probability error |
|---:|---:|---:|---:|---:|
${efficiency}

Runs without both automatic verdict classes in the calibration labels are reported as unsupported rather than silently included.
`;
}

export async function analyzePilot({
  pilotDir,
  populationInput,
  resultsFile = "judge-results.jsonl",
  outputPrefix = "pilot",
}) {
  const resolved = path.resolve(pilotDir);
  const selectedResultsFile = safeLeafName(resultsFile, "Pilot results file");
  const selectedOutputPrefix = safeOutputPrefix(outputPrefix);
  const protocol = await readJson(path.join(resolved, "protocol.json"), "pilot protocol");
  const analysis = await readJson(path.join(resolved, "analysis-key.json"), "pilot analysis key");
  const results = await readResults(path.join(resolved, selectedResultsFile));
  const records = buildEvidence(analysis.items, results);
  const populationRecords = await readEvidence(populationInput);

  const comparisonOptions = {
    baseline: protocol.baseline,
    candidate: protocol.candidate,
    iterations: 10000,
    seed: protocol.seed,
  };
  const human = comparePolicies(records, comparisonOptions);
  const machine = comparePolicies(machineAsHuman(records), comparisonOptions);
  const population = comparePolicies(populationRecords, comparisonOptions);
  const audit = auditJudge(records, ["policy", "site"]);
  const efficiency = labelEfficiency(records, protocol, human);
  const fnrGap = policyRateGap(audit, "false_negative_rate");
  const fprGap = policyRateGap(audit, "false_positive_rate");
  const effectShift = human.mean - machine.mean;
  const probabilityShift = human.probability_greater - machine.probability_greater;
  const twentyPercent = efficiency.find((item) => item.fraction === 0.2);
  const strong = machine.decision !== human.decision || Math.sign(machine.mean) !== Math.sign(human.mean) ||
    (twentyPercent?.reconstruction_rate ?? 0) >= 0.8;
  const continues = Math.abs(effectShift) >= 0.01 || Math.abs(probabilityShift) >= 0.10 ||
    (fnrGap !== null && fnrGap >= 0.10) || (fprGap !== null && fprGap >= 0.10);
  const kill = Math.abs(effectShift) < 0.005 && (fnrGap === null || fnrGap < 0.05) &&
    (fprGap === null || fprGap < 0.05) && (twentyPercent?.reconstruction_rate ?? 0) < 0.5;
  const exploratoryGate = strong ? "STRONG_SIGNAL" : continues ? "CONTINUE" : kill ? "KILL" : "INCONCLUSIVE";

  const report = {
    report_version: 1,
    protocol,
    judgments: {
      completed: results.length,
      expected: analysis.items.length,
      result_file: selectedResultsFile,
      mode: results.every((result) => typeof result.review_method === "string")
        ? "manual_local_review"
        : "automatic_model",
      models: unique(results.map((result) => result.model)),
      model_versions: unique(results.map((result) => result.model_version)),
      prompt_versions: unique(results.map((result) => result.prompt_version)),
      prompt_sha256: unique(results.map((result) => result.prompt_sha256)),
      review_methods: unique(results.map((result) => result.review_method)),
    },
    population_human: population,
    sample: { machine, human },
    judge_audit: audit,
    label_efficiency: efficiency,
    signals: {
      human_minus_machine_effect_shift: effectShift,
      posterior_probability_shift: probabilityShift,
      policy_false_negative_rate_gap: fnrGap,
      policy_false_positive_rate_gap: fprGap,
    },
    distortion: {
      policy_pairs: 1,
      decision_changed: machine.decision !== human.decision,
      ranking_changed: Math.sign(machine.mean) !== Math.sign(human.mean),
      decision_distortion_rate: Number(machine.decision !== human.decision),
      ranking_distortion_rate: Number(Math.sign(machine.mean) !== Math.sign(human.mean)),
      generalizable_rate: false,
    },
    exploratory_gate: exploratoryGate,
    limitations: [
      "The 100-session pilot estimates judge behavior on the sample, not a calibrated result for all 802 population sessions.",
      "Existing RoboArena human outcomes are treated as reference labels, not infallible ground truth.",
      "Task strings are free-form and no task-level inference is claimed.",
    ],
  };
  if (report.judgments.mode === "manual_local_review") {
    report.limitations.unshift(
      "The frozen protocol named Gemini, but this user-directed run used local manual review; no Gemini-bias claim is supported by these results.",
    );
  }
  const artifacts = {
    analysis: `${selectedOutputPrefix}-analysis.json`,
    evidence: `${selectedOutputPrefix}-evidence.jsonl`,
    report: `${selectedOutputPrefix}-report.md`,
  };
  report.artifacts = artifacts;
  await writeJsonAtomic(path.join(resolved, artifacts.analysis), report);
  await writeTextAtomic(
    path.join(resolved, artifacts.evidence),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  await writeTextAtomic(path.join(resolved, artifacts.report), markdown(report));
  return report;
}
