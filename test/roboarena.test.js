import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { importRoboArena, parseRoboArenaMetadata } from "../src/roboarena.js";

const fixturePath = path.join(import.meta.dirname, "fixtures", "roboarena-metadata.yaml");

test("parses the documented RoboArena session metadata shape", async () => {
  const metadata = parseRoboArenaMetadata(await readFile(fixturePath, "utf8"), "fixture.yaml");
  assert.equal(metadata.evaluation_location, "frodobots");
  assert.equal(metadata.language_instruction, "open the fridge door");
  assert.equal(metadata.preference, "TIE");
  assert.deepEqual(Object.keys(metadata.policies).sort(), ["A", "B"]);
  assert.equal(metadata.policies.A.policy_name, "paligemma_fast_droid");
  assert.equal(metadata.policies.B.binary_success, 0);
  assert.equal(metadata.policies.B.partial_success, 0.1);
});

test("imports metadata and video provenance without reading or copying payloads", async (context) => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "roboeval-import-"));
  context.after(async () => rm(temporaryRoot, { recursive: true, force: true }));
  const datasetRoot = path.join(temporaryRoot, "DataDump_07-17-2026");
  const sessionRoot = path.join(datasetRoot, "evaluation_sessions", "session-1");
  await mkdir(path.join(sessionRoot, "A_paligemma_fast_droid"), { recursive: true });
  await mkdir(path.join(sessionRoot, "B_paligemma_fast_specialist_droid"), { recursive: true });
  await writeFile(path.join(datasetRoot, "global_metadata.yaml"), "total_sessions: 1\n");
  await writeFile(path.join(sessionRoot, "metadata.yaml"), await readFile(fixturePath, "utf8"));
  await writeFile(path.join(sessionRoot, "A_paligemma_fast_droid", "video_wrist.mp4"), "not-real-video");
  const output = path.join(temporaryRoot, "normalized.jsonl");

  const result = await importRoboArena({ dataRoot: datasetRoot, output });
  assert.equal(result.sessionCount, 1);
  assert.equal(result.recordCount, 2);
  assert.equal(result.singlePolicySessions, 0);
  assert.equal(result.recordsWithoutHumanOutcome, 0);
  const records = (await readFile(output, "utf8")).trim().split("\n").map(JSON.parse);
  assert.equal(records[0].automatic_judge, null);
  assert.equal(records[0].task, "open the fridge door");
  const baseline = records.find((record) => record.policy === "paligemma_fast_droid");
  assert.deepEqual(
    baseline.video_paths,
    ["evaluation_sessions/session-1/A_paligemma_fast_droid/video_wrist.mp4"],
  );
  assert.equal(
    await readFile(path.join(sessionRoot, "A_paligemma_fast_droid", "video_wrist.mp4"), "utf8"),
    "not-real-video",
  );
});

test("retains a documented-shape single-policy session for provenance", () => {
  const metadata = parseRoboArenaMetadata(`
evaluation_location: lab
language_instruction: open drawer
preference: null
policies:
  DREAM:
    policy_name: UNLABELED_DREAM
    binary_success: 0
    partial_success: 0.5
`, "single.yaml");
  assert.deepEqual(Object.keys(metadata.policies), ["DREAM"]);
});
