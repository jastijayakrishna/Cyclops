import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { geminiRetryPolicy } from "../src/gemini-judge.js";
import { judgePrompt, promptHash } from "../src/judge-prompt.js";
import { analyzePilot } from "../src/pilot-analysis.js";
import { buildPilot, createPilotFiles } from "../src/pilot.js";

function records(count = 120) {
  return Array.from({ length: count }, (_, index) => {
    const comparison = `session-${String(index).padStart(3, "0")}`;
    return [
      {
        schema_version: 1,
        trial_id: `${comparison}:A`,
        comparison_id: comparison,
        policy: "policy-a",
        task: `task ${index % 5}`,
        site: `site ${index % 3}`,
        timestamp: null,
        automatic_judge: null,
        human: { success: index % 2 === 0, score: index % 2 === 0 ? 1 : 0, source: "test" },
        video_paths: [],
      },
      {
        schema_version: 1,
        trial_id: `${comparison}:B`,
        comparison_id: comparison,
        policy: "policy-b",
        task: `task ${index % 5}`,
        site: `site ${index % 3}`,
        timestamp: null,
        automatic_judge: null,
        human: { success: index % 3 === 0, score: index % 3 === 0 ? 1 : 0, source: "test" },
        video_paths: [],
      },
    ];
  }).flat();
}

test("freezes a deterministic, paired, blinded 100-session pilot", () => {
  const options = { baseline: "policy-a", candidate: "policy-b", sessions: 100, seed: 42 };
  const first = buildPilot(records(), options);
  const second = buildPilot(records(), options);
  assert.deepEqual(first, second);
  assert.equal(first.protocol.population_matched_sessions, 120);
  assert.equal(first.analysisItems.length, 200);
  assert.equal(first.judgeTasks.length, 200);
  assert.equal(new Set(first.analysisItems.map((item) => item.comparison_id)).size, 100);
  for (const task of first.judgeTasks) {
    assert.deepEqual(Object.keys(task).sort(), ["instruction", "item_id"]);
    assert.equal("policy" in task, false);
    assert.equal("human_success" in task, false);
    assert.equal("site" in task, false);
  }
});

test("writes separate blinded tasks and private analysis keys", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "roboeval-pilot-"));
  const outputDir = path.join(root, "missing-parent", "pilot");
  context.after(async () => rm(root, { recursive: true, force: true }));
  const result = await createPilotFiles({
    records: records(),
    baseline: "policy-a",
    candidate: "policy-b",
    sessions: 100,
    seed: 42,
    outputDir,
  });
  assert.equal(result.sampledVideos, 200);
  const tasksText = await readFile(path.join(outputDir, "judge-tasks.json"), "utf8");
  assert.doesNotMatch(tasksText, /policy-a|policy-b|human_success|site 0/u);
  const keyText = await readFile(path.join(outputDir, "analysis-key.json"), "utf8");
  assert.match(keyText, /policy-a/u);
});

test("judge prompt contract is stable and contains no hidden evaluation fields", () => {
  const prompt = judgePrompt("open the drawer");
  assert.match(prompt, /Task instruction: open the drawer/u);
  assert.doesNotMatch(prompt, /human_success|policy-a|policy-b/u);
  assert.match(promptHash(), /^[a-f0-9]{64}$/u);
});

test("does not burn retries on a hard Gemini daily quota", () => {
  const body = JSON.stringify({
    error: {
      status: "RESOURCE_EXHAUSTED",
      details: [{
        violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
      }, { retryDelay: "12.7s" }],
    },
  });
  assert.deepEqual(
    geminiRetryPolicy({ status: 429, body, retryAfter: null }),
    { retry: false, delayMs: 0, reason: "daily-quota" },
  );
});

test("honors Gemini retry guidance for transient rate limits", () => {
  const body = JSON.stringify({ error: { details: [{ retryDelay: "12.7s" }] } });
  assert.deepEqual(
    geminiRetryPolicy({ status: 429, body, retryAfter: null }),
    { retry: true, delayMs: 12700, reason: "rate-limit" },
  );
});

test("analyzes an explicitly selected manual result file into separate artifacts", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "roboeval-manual-analysis-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const pilotDir = path.join(root, "pilot");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(pilotDir, { recursive: true }));
  const population = records(20);
  const analysisItems = population.map((record, index) => ({
    item_id: `item-${String(index).padStart(3, "0")}`,
    trial_id: record.trial_id,
    comparison_id: record.comparison_id,
    policy: record.policy,
    task: record.task,
    site: record.site,
    timestamp: record.timestamp,
    human_score: record.human.score,
    human_success: record.human.success,
  }));
  const results = analysisItems.map((item, index) => {
    const success = index % 3 !== 0;
    return {
      result_version: 1,
      item_id: item.item_id,
      model: "test-local-reviewer",
      model_version: "test-local-reviewer-v1",
      prompt_version: "manual-test-v1",
      prompt_sha256: "a".repeat(64),
      success,
      automatic_score: success ? 0.8 : 0.2,
      confidence: 0.8,
      reason_code: success ? "COMPLETE" : "NO_PROGRESS",
      evidence: "test evidence",
      review_method: "local-manual-test",
    };
  });
  const protocol = {
    baseline: "policy-a",
    candidate: "policy-b",
    seed: 42,
    analysis: {
      label_fractions: [0.2, 1],
      subsample_repetitions: 2,
      reconstruction_effect_tolerance: 0.02,
      reconstruction_probability_tolerance: 0.1,
    },
  };
  const populationPath = path.join(root, "population.jsonl");
  await Promise.all([
    writeFile(path.join(pilotDir, "protocol.json"), `${JSON.stringify(protocol)}\n`),
    writeFile(path.join(pilotDir, "analysis-key.json"), `${JSON.stringify({ items: analysisItems })}\n`),
    writeFile(
      path.join(pilotDir, "manual-results.jsonl"),
      `${results.map((result) => JSON.stringify(result)).join("\n")}\n`,
    ),
    writeFile(populationPath, `${population.map((record) => JSON.stringify(record)).join("\n")}\n`),
  ]);

  const report = await analyzePilot({
    pilotDir,
    populationInput: populationPath,
    resultsFile: "manual-results.jsonl",
    outputPrefix: "manual-pilot",
  });

  assert.equal(report.judgments.mode, "manual_local_review");
  assert.equal(report.judgments.result_file, "manual-results.jsonl");
  assert.deepEqual(report.judgments.review_methods, ["local-manual-test"]);
  assert.equal(report.distortion.policy_pairs, 1);
  assert.equal(report.distortion.generalizable_rate, false);
  assert.match(await readFile(path.join(pilotDir, "manual-pilot-report.md"), "utf8"), /not Gemini distortion/u);
  assert.equal(JSON.parse(await readFile(path.join(pilotDir, "manual-pilot-analysis.json"), "utf8")).artifacts.evidence,
    "manual-pilot-evidence.jsonl");
});

test("rejects pilot result paths that escape the pilot directory", async () => {
  await assert.rejects(
    analyzePilot({ pilotDir: ".", populationInput: "unused", resultsFile: "../results.jsonl" }),
    /must be a file name inside the pilot directory/u,
  );
});
