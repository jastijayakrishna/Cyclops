import { createHash } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { UserError } from "./errors.js";
import { humanSuccess, matchedPairs } from "./evidence.js";
import { JUDGE_MODEL, JUDGE_PROMPT_VERSION, promptHash } from "./judge-prompt.js";
import { writeJsonAtomic } from "./json-files.js";
import { createRandom } from "./random.js";

function shuffled(values, seed) {
  const result = [...values];
  const random = createRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function itemId(seed, comparisonId, role) {
  return createHash("sha256")
    .update(`${seed}:${comparisonId}:${role}`, "utf8")
    .digest("hex")
    .slice(0, 20);
}

function sourceLabel(record) {
  const prefix = `${record.comparison_id}:`;
  if (!record.trial_id.startsWith(prefix)) {
    throw new UserError(`Trial ${record.trial_id} does not encode its comparison id`);
  }
  return record.trial_id.slice(prefix.length);
}

export function buildPilot(records, {
  baseline,
  candidate,
  sessions = 100,
  seed = 20260811,
} = {}) {
  if (!Number.isInteger(sessions) || sessions < 20) {
    throw new UserError("Pilot sessions must be an integer of at least 20");
  }
  const population = matchedPairs(records, baseline, candidate, humanSuccess)
    .sort((left, right) => left.comparison_id.localeCompare(right.comparison_id));
  if (population.length < sessions) {
    throw new UserError(`Requested ${sessions} pilot sessions, but only ${population.length} matched sessions exist`);
  }
  const selected = shuffled(population, seed).slice(0, sessions);
  const analysisItems = [];
  const judgeTasks = [];
  for (const pair of selected) {
    for (const [role, record] of [["baseline", pair.baseline], ["candidate", pair.candidate]]) {
      const id = itemId(seed, pair.comparison_id, role);
      analysisItems.push({
        item_id: id,
        comparison_id: pair.comparison_id,
        role,
        policy: record.policy,
        trial_id: record.trial_id,
        source_label: sourceLabel(record),
        task: record.task,
        site: record.site,
        timestamp: record.timestamp,
        human_success: humanSuccess(record),
        human_score: record.human?.score ?? null,
      });
      judgeTasks.push({ item_id: id, instruction: record.task });
    }
  }
  analysisItems.sort((left, right) => left.item_id.localeCompare(right.item_id));
  judgeTasks.sort((left, right) => left.item_id.localeCompare(right.item_id));

  const protocol = {
    protocol_version: 1,
    maturity: "exploratory_validation_pilot",
    baseline,
    candidate,
    population_matched_sessions: population.length,
    sampled_sessions: sessions,
    sampled_videos: sessions * 2,
    selection: "uniform_without_replacement_after_lexical_sort",
    seed,
    media: "one wrist MP4 per policy episode",
    blinding: "judge receives only task instruction and video; policy, site, and human labels are withheld",
    judge: {
      provider: "google-gemini-api",
      model: JUDGE_MODEL,
      temperature: 0,
      thinking_budget: 0,
      prompt_version: JUDGE_PROMPT_VERSION,
      prompt_sha256: promptHash(),
      maximum_api_requests: 220,
      maximum_input_tokens: 10000000,
    },
    analysis: {
      decision_threshold: 0.95,
      label_fractions: [0.1, 0.2, 0.5, 1],
      subsample_repetitions: 50,
      reconstruction_effect_tolerance: 0.02,
      reconstruction_probability_tolerance: 0.1,
    },
    exploratory_gates: {
      kill_if_all: [
        "absolute human-minus-machine effect shift < 0.005",
        "absolute policy false-negative-rate gap < 0.05",
        "no material label-efficiency signal",
      ],
      continue_if_any: [
        "absolute human-minus-machine effect shift >= 0.01",
        "absolute posterior-probability shift >= 0.10",
        "absolute policy error-rate gap >= 0.10",
      ],
      strong_if_any: [
        "machine and human ranking or decision differ",
        "20% human labels reliably reconstruct the full-human result",
      ],
    },
  };
  return { protocol, analysisItems, judgeTasks };
}

export async function createPilotFiles({ outputDir, ...options }) {
  const resolved = path.resolve(outputDir);
  try {
    await stat(resolved);
    throw new UserError(`Pilot output directory already exists; refusing to overwrite it: ${resolved}`);
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (error.code !== "ENOENT") throw error;
  }
  const pilot = buildPilot(options.records, options);
  await mkdir(path.dirname(resolved), { recursive: true });
  await mkdir(resolved, { recursive: false });
  await writeJsonAtomic(path.join(resolved, "protocol.json"), pilot.protocol);
  await writeJsonAtomic(path.join(resolved, "analysis-key.json"), {
    protocol_version: pilot.protocol.protocol_version,
    items: pilot.analysisItems,
  });
  await writeJsonAtomic(path.join(resolved, "judge-tasks.json"), {
    protocol_version: pilot.protocol.protocol_version,
    prompt_sha256: pilot.protocol.judge.prompt_sha256,
    items: pilot.judgeTasks,
  });
  return {
    outputDir: resolved,
    populationSessions: pilot.protocol.population_matched_sessions,
    sampledSessions: pilot.protocol.sampled_sessions,
    sampledVideos: pilot.protocol.sampled_videos,
    promptSha256: pilot.protocol.judge.prompt_sha256,
  };
}
