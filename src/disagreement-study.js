import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { UserError } from "./errors.js";
import { createRandom } from "./random.js";

export const STRICT_RUBRIC = `STRICT SUCCESS RUBRIC
Count SUCCESS only when the requested final state is clearly visible and fully achieved.
Count FAILURE when there is only partial progress, the outcome is not visible, the wrong action occurs,
there is no meaningful progress, or the run aborts. Do not infer completion outside the camera view.`;

export const PROGRESS_RUBRIC = `PROGRESS-AWARE SUCCESS RUBRIC
Count SUCCESS when either (a) the requested final state is clearly visible and fully achieved, or
(b) substantial completion is visible: the robot correctly performs the central task action and leaves
a clear, durable change toward the requested end state, with only a minor final placement, closure, or
visibility detail missing. Count FAILURE for a mere grasp or initial motion, limited progress, wrong-object
or wrong-direction action, an unverifiable outcome, no meaningful progress, or an aborted run.`;

const STUDY_VERSION = 1;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fileSha256(filePath) {
  return sha256(await readFile(filePath));
}

function shuffle(values, seed) {
  const result = [...values];
  const random = createRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new UserError(`Cannot read ${label}: ${filePath}`, error.message);
  }
}

async function readJsonLines(filePath, label) {
  try {
    return (await readFile(filePath, "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    throw new UserError(`Cannot read ${label}: ${filePath}`, error.message);
  }
}

async function writeExclusiveAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, value, { flag: "wx" });
  await rename(temporary, filePath);
}

function mapUnique(items, field, label) {
  const result = new Map();
  for (const item of items) {
    if (!item || typeof item[field] !== "string" || result.has(item[field])) {
      throw new UserError(`${label} contains a missing or duplicate ${field}`);
    }
    result.set(item[field], item);
  }
  return result;
}

function blindedTasks(disagreements, taskMap, videoMap, pass, seed) {
  const ordered = shuffle([...disagreements].sort((left, right) => left.item_id.localeCompare(right.item_id)), seed);
  return ordered.map((item, index) => {
    const task = taskMap.get(item.item_id);
    const video = videoMap.get(item.item_id);
    if (!task || !video) throw new UserError(`Missing blinded task or video for ${item.item_id}`);
    return {
      study_item_id: sha256(`${STUDY_VERSION}:${pass}:${seed}:${item.item_id}`).slice(0, 20),
      sequence: index + 1,
      instruction: task.instruction,
      media_relative_path: path.posix.join("..", ...video.local_path.split(/[\\/]/u)),
      media_sha256: video.sha256,
    };
  });
}

function assertBlinded(tasks, forbiddenValues) {
  const text = JSON.stringify(tasks);
  const forbiddenFields = ["policy", "site", "human_success", "original", "reference", "reason_code"];
  for (const field of forbiddenFields) {
    if (text.includes(`\"${field}\"`)) throw new UserError(`Blinded tasks leak forbidden field ${field}`);
  }
  for (const value of forbiddenValues) {
    if (typeof value === "string" && value && text.includes(value)) {
      throw new UserError("Blinded tasks leak a policy identity");
    }
  }
}

export async function createDisagreementStudy({ pilotDir, studyDir, seed = 20260812 }) {
  const resolvedPilot = path.resolve(pilotDir);
  const resolvedStudy = path.resolve(studyDir ?? path.join(resolvedPilot, "disagreement-rereview"));
  if (path.dirname(resolvedStudy) !== resolvedPilot) {
    throw new UserError("Disagreement study directory must be a direct child of the pilot directory");
  }
  if (!Number.isInteger(seed)) throw new UserError("Disagreement study seed must be an integer");

  const paths = {
    analysis: path.join(resolvedPilot, "analysis-key.json"),
    tasks: path.join(resolvedPilot, "judge-tasks.json"),
    videos: path.join(resolvedPilot, "video-index.json"),
    original: path.join(resolvedPilot, "manual-judge-results.jsonl"),
    protocol: path.join(resolvedPilot, "protocol.json"),
  };
  const [analysis, tasksFile, videosFile, originals, pilotProtocol] = await Promise.all([
    readJson(paths.analysis, "pilot analysis key"),
    readJson(paths.tasks, "blinded judge tasks"),
    readJson(paths.videos, "video index"),
    readJsonLines(paths.original, "original manual judgments"),
    readJson(paths.protocol, "pilot protocol"),
  ]);
  const analysisMap = mapUnique(analysis.items ?? [], "item_id", "Pilot analysis key");
  const taskMap = mapUnique(tasksFile.items ?? [], "item_id", "Blinded judge tasks");
  const videoMap = mapUnique(videosFile.videos ?? [], "item_id", "Video index");
  const originalMap = mapUnique(originals, "item_id", "Original manual judgments");
  if (analysisMap.size !== originalMap.size) {
    throw new UserError(`Pilot has ${analysisMap.size} analysis items but ${originalMap.size} original judgments`);
  }

  const disagreements = [...analysisMap.values()].filter((item) => {
    const original = originalMap.get(item.item_id);
    if (!original || typeof original.success !== "boolean" || typeof item.human_success !== "boolean") {
      throw new UserError(`Incomplete original/reference verdict for ${item.item_id}`);
    }
    return original.success !== item.human_success;
  });
  if (disagreements.length === 0) throw new UserError("Pilot contains no disagreements to re-review");

  const strictSeed = seed + 1;
  const progressSeed = seed + 2;
  const strictTasks = blindedTasks(disagreements, taskMap, videoMap, "strict", strictSeed);
  const progressTasks = blindedTasks(disagreements, taskMap, videoMap, "progress", progressSeed);
  assertBlinded(strictTasks, [pilotProtocol.baseline, pilotProtocol.candidate]);
  assertBlinded(progressTasks, [pilotProtocol.baseline, pilotProtocol.candidate]);
  if (strictTasks.map((item) => item.media_sha256).join("|") === progressTasks.map((item) => item.media_sha256).join("|")) {
    throw new UserError("Strict and progress-aware task orders unexpectedly match");
  }

  const strictByHash = new Map(strictTasks.map((item) => [item.media_sha256, item.study_item_id]));
  const progressByHash = new Map(progressTasks.map((item) => [item.media_sha256, item.study_item_id]));
  const privateItems = disagreements.map((item) => {
    const original = originalMap.get(item.item_id);
    const video = videoMap.get(item.item_id);
    return {
      item_id: item.item_id,
      strict_study_item_id: strictByHash.get(video.sha256),
      progress_study_item_id: progressByHash.get(video.sha256),
      comparison_id: item.comparison_id,
      policy: item.policy,
      task: item.task,
      site: item.site,
      original_success: original.success,
      original_reason_code: original.reason_code,
      reference_success: item.human_success,
    };
  });

  const publicProtocol = {
    study_version: STUDY_VERSION,
    status: "frozen_before_rereview",
    created_at: new Date().toISOString(),
    source_pilot_relative_path: "..",
    selected_items: disagreements.length,
    selection: "all original-local-review versus RoboArena-reference binary disagreements",
    blinding: [
      "original local verdict hidden",
      "RoboArena reference verdict hidden",
      "policy identity hidden",
      "site identity hidden",
      "original item identity replaced by pass-specific study identity",
      "strict and progress-aware passes independently reshuffled",
    ],
    pass_order: ["strict", "progress"],
    passes: {
      strict: { seed: strictSeed, rubric: STRICT_RUBRIC, rubric_sha256: sha256(STRICT_RUBRIC), tasks_file: "strict-tasks.json", results_file: "strict-results.jsonl" },
      progress: { seed: progressSeed, rubric: PROGRESS_RUBRIC, rubric_sha256: sha256(PROGRESS_RUBRIC), tasks_file: "progress-tasks.json", results_file: "progress-results.jsonl" },
    },
    thresholds: { unstable_at_or_below: 0.60, strong_at_or_above: 0.90 },
    analysis_plan: [
      "Binary test-retest agreement and Cohen kappa for original versus strict rereview",
      "Exact reason-code agreement for original versus strict rereview",
      "Policy success rates and candidate-minus-baseline gap under each rubric",
      "Full-pilot carry-forward sensitivity replacing only the 47 selected judgments",
      "Separate incomplete-machine-judge coverage from complete rankings",
    ],
    source_sha256: {
      analysis_key: await fileSha256(paths.analysis),
      judge_tasks: await fileSha256(paths.tasks),
      video_index: await fileSha256(paths.videos),
      original_manual_results: await fileSha256(paths.original),
      pilot_protocol: await fileSha256(paths.protocol),
    },
  };
  const privateKey = {
    study_version: STUDY_VERSION,
    sealed_until_both_passes_complete: true,
    items: privateItems,
  };

  await mkdir(resolvedStudy, { recursive: false });
  await Promise.all([
    writeExclusiveAtomic(path.join(resolvedStudy, "study-protocol.json"), `${JSON.stringify(publicProtocol, null, 2)}\n`),
    writeExclusiveAtomic(path.join(resolvedStudy, "strict-tasks.json"), `${JSON.stringify({ study_version: STUDY_VERSION, pass: "strict", items: strictTasks }, null, 2)}\n`),
    writeExclusiveAtomic(path.join(resolvedStudy, "progress-tasks.json"), `${JSON.stringify({ study_version: STUDY_VERSION, pass: "progress", items: progressTasks }, null, 2)}\n`),
    writeExclusiveAtomic(path.join(resolvedStudy, "private-analysis-key.json"), `${JSON.stringify(privateKey, null, 2)}\n`),
  ]);

  return { studyDir: resolvedStudy, selectedItems: disagreements.length, strictSeed, progressSeed };
}

function wilson(successes, total, z = 1.959963984540054) {
  if (total === 0) return { low: null, high: null };
  const p = successes / total;
  const denominator = 1 + z ** 2 / total;
  const center = (p + z ** 2 / (2 * total)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * total)) / total) / denominator;
  return { low: center - half, high: center + half };
}

function confusion(left, right) {
  const result = { left_success_right_success: 0, left_success_right_failure: 0, left_failure_right_success: 0, left_failure_right_failure: 0 };
  for (let index = 0; index < left.length; index += 1) {
    const key = `${left[index] ? "left_success" : "left_failure"}_${right[index] ? "right_success" : "right_failure"}`;
    result[key] += 1;
  }
  return result;
}

function cohenKappa(left, right) {
  const total = left.length;
  if (!total) return null;
  const observed = left.filter((value, index) => value === right[index]).length / total;
  const leftRate = left.filter(Boolean).length / total;
  const rightRate = right.filter(Boolean).length / total;
  const expected = leftRate * rightRate + (1 - leftRate) * (1 - rightRate);
  return expected === 1 ? (observed === 1 ? 1 : null) : (observed - expected) / (1 - expected);
}

function ranking(rows, baseline, candidate) {
  const byPolicy = {};
  for (const policy of [baseline, candidate]) {
    const values = rows.filter((row) => row.policy === policy);
    byPolicy[policy] = { successes: values.filter((row) => row.success).length, total: values.length };
    byPolicy[policy].rate = values.length ? byPolicy[policy].successes / values.length : null;
  }
  const difference = byPolicy[candidate].rate === null || byPolicy[baseline].rate === null
    ? null : byPolicy[candidate].rate - byPolicy[baseline].rate;
  return {
    by_policy: byPolicy,
    candidate_minus_baseline: difference,
    ranking: difference === null ? "UNAVAILABLE" : difference > 0 ? "CANDIDATE" : difference < 0 ? "BASELINE" : "TIE",
  };
}

function percent(value) {
  return value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

function markdown(report) {
  const self = report.self_reproduction;
  const strict = report.policy_ranking.full_pilot_carry_forward.strict;
  const progress = report.policy_ranking.full_pilot_carry_forward.progress_aware;
  const reference = report.policy_ranking.full_pilot_carry_forward.reference;
  return `# Blinded disagreement rereview findings

Status: completed ${report.completed_at.slice(0, 10)}. Both passes were completed before unblinding.

## Self-reproduction under the strict rubric

The strict rereview reproduced ${self.agreements}/${self.total} original binary verdicts: **${percent(self.rate)}**
(95% Wilson interval ${percent(self.interval_95.low)} to ${percent(self.interval_95.high)}; Cohen's kappa ${self.cohen_kappa.toFixed(3)}).
The preregistered interpretation is **${self.interpretation}** (unstable at or below 60%; strong at or above 90%).
Exact reason-code reproduction was ${percent(self.reason_code_agreement_rate)}.

## Success-definition sensitivity

The 47 selected disagreements were judged again under a separately reshuffled progress-aware rubric.
For a focused full-pilot sensitivity calculation, the other 153 original strict judgments were carried forward unchanged.

| Evaluator definition | Baseline success | Candidate success | Candidate minus baseline | Ranking |
|---|---:|---:|---:|---|
| Strict rereview carry-forward | ${percent(strict.by_policy[report.baseline].rate)} | ${percent(strict.by_policy[report.candidate].rate)} | ${percent(strict.candidate_minus_baseline)} | ${strict.ranking} |
| Progress-aware carry-forward | ${percent(progress.by_policy[report.baseline].rate)} | ${percent(progress.by_policy[report.candidate].rate)} | ${percent(progress.candidate_minus_baseline)} | ${progress.ranking} |
| RoboArena reference | ${percent(reference.by_policy[report.baseline].rate)} | ${percent(reference.by_policy[report.candidate].rate)} | ${percent(reference.candidate_minus_baseline)} | ${reference.ranking} |

The strict and progress-aware carry-forward rankings ${strict.ranking === progress.ranking ? "do not change" : "change"} on this focused sensitivity test.
This is not a full progress-aware re-annotation of all 200 videos; unreviewed cases could still change the result.

## Evaluator coverage

No API call was made. The pre-existing Gemini file covers ${report.machine_judges.existing_gemini.completed}/${report.machine_judges.existing_gemini.required}
videos (${percent(report.machine_judges.existing_gemini.coverage)}) and is non-random/incomplete, so it cannot provide a valid full-pilot policy ranking.
No installed local vision-model runtime or weights were available during the capability check. Independent multi-model ranking remains untested.
`;
}

export async function analyzeDisagreementStudy({ studyDir }) {
  const resolvedStudy = path.resolve(studyDir);
  const [protocol, privateKey, strictResults, progressResults] = await Promise.all([
    readJson(path.join(resolvedStudy, "study-protocol.json"), "disagreement study protocol"),
    readJson(path.join(resolvedStudy, "private-analysis-key.json"), "private analysis key"),
    readJsonLines(path.join(resolvedStudy, "strict-results.jsonl"), "strict rereview results"),
    readJsonLines(path.join(resolvedStudy, "progress-results.jsonl"), "progress-aware rereview results"),
  ]);
  const expected = protocol.selected_items;
  const strictMap = mapUnique(strictResults, "study_item_id", "Strict rereview results");
  const progressMap = mapUnique(progressResults, "study_item_id", "Progress-aware rereview results");
  if (strictMap.size !== expected || progressMap.size !== expected) {
    throw new UserError(`Both rereview passes must contain ${expected} unique results before unblinding; found strict=${strictMap.size}, progress=${progressMap.size}`);
  }
  const pilotDir = path.resolve(resolvedStudy, protocol.source_pilot_relative_path);
  const sourcePaths = {
    analysis: path.join(pilotDir, "analysis-key.json"),
    original: path.join(pilotDir, "manual-judge-results.jsonl"),
    gemini: path.join(pilotDir, "judge-results.jsonl"),
    pilotProtocol: path.join(pilotDir, "protocol.json"),
  };
  const [analysis, originals, pilotProtocol] = await Promise.all([
    readJson(sourcePaths.analysis, "pilot analysis key"),
    readJsonLines(sourcePaths.original, "original manual judgments"),
    readJson(sourcePaths.pilotProtocol, "pilot protocol"),
  ]);
  for (const [name, expectedHash] of Object.entries({ analysis_key: protocol.source_sha256.analysis_key, original_manual_results: protocol.source_sha256.original_manual_results, pilot_protocol: protocol.source_sha256.pilot_protocol })) {
    const actualPath = name === "analysis_key" ? sourcePaths.analysis : name === "original_manual_results" ? sourcePaths.original : sourcePaths.pilotProtocol;
    if (await fileSha256(actualPath) !== expectedHash) throw new UserError(`Frozen source changed after study creation: ${name}`);
  }
  const keyItems = privateKey.items ?? [];
  if (keyItems.length !== expected) throw new UserError("Private analysis key does not match the frozen selected-item count");
  const selectedRows = keyItems.map((item) => {
    const strict = strictMap.get(item.strict_study_item_id);
    const progress = progressMap.get(item.progress_study_item_id);
    if (!strict || !progress) throw new UserError(`Missing rereview result for private item ${item.item_id}`);
    return { ...item, strict, progress };
  });
  const originalBinary = selectedRows.map((row) => row.original_success);
  const strictBinary = selectedRows.map((row) => row.strict.success);
  const agreements = originalBinary.filter((value, index) => value === strictBinary[index]).length;
  const rate = agreements / expected;
  const interpretation = rate <= protocol.thresholds.unstable_at_or_below ? "UNSTABLE" : rate >= protocol.thresholds.strong_at_or_above ? "STRONG_REPRODUCTION" : "INTERMEDIATE";
  const reasonAgreements = selectedRows.filter((row) => row.original_reason_code === row.strict.reason_code).length;

  const selectedStrict = selectedRows.map((row) => ({ policy: row.policy, success: row.strict.success }));
  const selectedProgress = selectedRows.map((row) => ({ policy: row.policy, success: row.progress.success }));
  const analysisMap = mapUnique(analysis.items ?? [], "item_id", "Pilot analysis key");
  const originalMap = mapUnique(originals, "item_id", "Original manual judgments");
  const selectedById = new Map(selectedRows.map((row) => [row.item_id, row]));
  const fullOriginal = [...analysisMap.values()].map((item) => ({ policy: item.policy, success: originalMap.get(item.item_id).success }));
  const fullStrict = [...analysisMap.values()].map((item) => ({
    policy: item.policy,
    success: selectedById.has(item.item_id) ? selectedById.get(item.item_id).strict.success : originalMap.get(item.item_id).success,
  }));
  const fullProgress = [...analysisMap.values()].map((item) => ({
    policy: item.policy,
    success: selectedById.has(item.item_id) ? selectedById.get(item.item_id).progress.success : originalMap.get(item.item_id).success,
  }));
  const fullReference = [...analysisMap.values()].map((item) => ({ policy: item.policy, success: item.human_success }));

  let gemini = [];
  try { gemini = await readJsonLines(sourcePaths.gemini, "existing partial Gemini judgments"); } catch (error) {
    if (!(error instanceof UserError) || !/Cannot read/u.test(error.message)) throw error;
  }
  const geminiMap = new Map(gemini.map((item) => [item.item_id, item]));
  const geminiSelected = selectedRows.filter((row) => geminiMap.has(row.item_id));
  const geminiPolicyRows = gemini.map((result) => ({ policy: analysisMap.get(result.item_id)?.policy, success: result.success })).filter((row) => row.policy);

  const report = {
    study_version: STUDY_VERSION,
    completed_at: new Date().toISOString(),
    baseline: pilotProtocol.baseline,
    candidate: pilotProtocol.candidate,
    blinding: { both_passes_completed_before_unblinding: true, selected_items: expected, pass_order: protocol.pass_order },
    self_reproduction: {
      total: expected,
      agreements,
      disagreements: expected - agreements,
      rate,
      interval_95: wilson(agreements, expected),
      cohen_kappa: cohenKappa(originalBinary, strictBinary),
      confusion: confusion(originalBinary, strictBinary),
      reason_code_agreements: reasonAgreements,
      reason_code_agreement_rate: reasonAgreements / expected,
      thresholds: protocol.thresholds,
      interpretation,
    },
    rubric_sensitivity: {
      selected_items_changed_between_strict_and_progress: selectedRows.filter((row) => row.strict.success !== row.progress.success).length,
      selected_items_progress_successes: selectedRows.filter((row) => row.progress.success).length,
      selected_items_strict_successes: selectedRows.filter((row) => row.strict.success).length,
      progress_reason_counts: Object.fromEntries([...new Set(progressResults.map((row) => row.reason_code))].sort().map((reason) => [reason, progressResults.filter((row) => row.reason_code === reason).length])),
    },
    policy_ranking: {
      selected_47_only: {
        strict: ranking(selectedStrict, pilotProtocol.baseline, pilotProtocol.candidate),
        progress_aware: ranking(selectedProgress, pilotProtocol.baseline, pilotProtocol.candidate),
      },
      full_pilot_carry_forward: {
        original_local_strict: ranking(fullOriginal, pilotProtocol.baseline, pilotProtocol.candidate),
        strict: ranking(fullStrict, pilotProtocol.baseline, pilotProtocol.candidate),
        progress_aware: ranking(fullProgress, pilotProtocol.baseline, pilotProtocol.candidate),
        reference: ranking(fullReference, pilotProtocol.baseline, pilotProtocol.candidate),
        limitation: "Only the 47 selected disagreements were re-reviewed; the other 153 original strict judgments were carried forward unchanged.",
      },
    },
    machine_judges: {
      no_api_calls_for_this_study: true,
      installed_local_vision_stack: false,
      capability_observation: "RTX 4060 Laptop GPU present; no Ollama/LM Studio runtime, local vision weights, torch, or transformers installation was available.",
      existing_gemini: {
        completed: gemini.length,
        required: analysisMap.size,
        coverage: gemini.length / analysisMap.size,
        selected_47_overlap: geminiSelected.length,
        complete_random_sample: false,
        policy_rates_on_incomplete_rows: ranking(geminiPolicyRows, pilotProtocol.baseline, pilotProtocol.candidate),
      },
      independent_full_pilot_rankings_available: 0,
      conclusion: "Independent multi-model ranking is untested; rubric variants from one reviewer are not independent machine judges.",
    },
    artifacts: { analysis: "disagreement-analysis.json", report: "disagreement-report.md" },
  };
  await Promise.all([
    writeExclusiveAtomic(path.join(resolvedStudy, "disagreement-analysis.json"), `${JSON.stringify(report, null, 2)}\n`),
    writeExclusiveAtomic(path.join(resolvedStudy, "disagreement-report.md"), markdown(report)),
  ]);
  return report;
}

