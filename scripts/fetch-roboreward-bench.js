#!/usr/bin/env node
// Downloads only public HELM RoboRewardBench JSON artifacts. Videos are not
// downloaded. The target must be outside this repository's data boundary.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const targetArg = arg("target");
const version = arg("version", "v0.0.1");
if (!targetArg) { console.error("--target is required"); process.exit(2); }
const target = path.resolve(targetArg);
const relative = path.relative(process.cwd(), target);
if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
  console.error("--target must be outside the repository; benchmark evidence is not committed to Git");
  process.exit(2);
}

const base = `https://storage.googleapis.com/crfm-helm-public/robo-reward-bench/benchmark_output/runs/${version}`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

mkdirSync(target, { recursive: true });
const runSpecBytes = await download(`${base}/run_specs.json`);
const runSpecs = JSON.parse(runSpecBytes.toString("utf8"));
const arenaRuns = runSpecs.filter((run) => run.scenario_spec?.args?.subset === "robo_arena");
if (arenaRuns.length === 0) throw new Error("The public manifest contains no RoboArena runs");

const instanceUrl = `${base}/${arenaRuns[0].name}/instances.json`;
const instanceBytes = await download(instanceUrl);
writeFileSync(path.join(target, "instances.json"), instanceBytes);

const manifest = {
  schema_version: 1,
  benchmark: "HELM RoboRewardBench",
  subset: "robo_arena",
  benchmark_version: version,
  retrieved_at: new Date().toISOString(),
  run_specs_url: `${base}/run_specs.json`,
  instances: { source_url: instanceUrl, file: "instances.json", bytes: instanceBytes.length, sha256: sha256(instanceBytes) },
  models: [],
};

for (let index = 0; index < arenaRuns.length; index += 1) {
  const run = arenaRuns[index];
  const model = run.adapter_spec?.model;
  if (!model) throw new Error(`Run has no model: ${run.name}`);
  const key = model.replace(/[^a-z0-9._-]+/giu, "__");
  const sourceUrl = `${base}/${run.name}/display_predictions.json`;
  const bytes = await download(sourceUrl);
  const file = `predictions/${key}.json`;
  mkdirSync(path.join(target, "predictions"), { recursive: true });
  writeFileSync(path.join(target, file), bytes);
  const predictions = JSON.parse(bytes.toString("utf8"));
  manifest.models.push({ model, key, run_name: run.name, source_url: sourceUrl, file, predictions: predictions.length, bytes: bytes.length, sha256: sha256(bytes) });
  console.log(`[${index + 1}/${arenaRuns.length}] ${model}: ${predictions.length} predictions`);
}

writeFileSync(path.join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`\nWrote ${target}`);
console.log(`models=${manifest.models.length}, instances=${JSON.parse(instanceBytes.toString("utf8")).length}, videos_downloaded=0`);
