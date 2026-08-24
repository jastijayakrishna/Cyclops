import { parseArgs } from "node:util";
import { auditJudge } from "./audit.js";
import { comparePolicies } from "./compare.js";
import { downloadRoboArenaMetadata } from "./download.js";
import { runGeminiJudge } from "./gemini-judge.js";
import { UserError } from "./errors.js";
import { readEvidence } from "./evidence.js";
import { formatAudit, formatComparison } from "./format.js";
import { importRoboArena } from "./roboarena.js";
import { runLocalJudge } from "./local-judge.js";
import { analyzePilot } from "./pilot-analysis.js";
import { downloadPilotVideos } from "./pilot-download.js";
import { createPilotFiles } from "./pilot.js";
import { certifyPolicyGraph } from "./policy-certificate.js";
import { readJson } from "./json-files.js";

const HELP = `Robot Evaluation Decision Engine

Usage:
  roboeval fetch-roboarena-metadata --target <external-directory>
  roboeval import-roboarena --data-root <external-dump> --output <normalized.jsonl>
  roboeval compare --input <evidence.jsonl> --baseline <policy> --candidate <policy> [options]
  roboeval certify --input <certificate-frame.json> [--json]
  roboeval audit-judge --input <evidence.jsonl> [--group-by policy,task,site] [--json]
  roboeval pilot-create --input <evidence.jsonl> --baseline <policy> --candidate <policy> --output-dir <external-dir>
  roboeval pilot-download --pilot-dir <external-dir>
  roboeval pilot-judge --pilot-dir <external-dir> [--max-new 200]
  roboeval pilot-judge-local --pilot-dir <external-dir> --model <ollama-model> [options]
  roboeval pilot-analyze --pilot-dir <external-dir> --population-input <evidence.jsonl> [options]

Local judge options (no API key, no network egress):
  --model <name>                 Vision model served locally, e.g. qwen2.5vl:7b
  --endpoint <url>               Ollama-compatible endpoint (default: http://127.0.0.1:11434)
  --frames <n>                   Frames sampled per video (default: 8)
  --max-new <n>                  Stop after this many new judgments
  Results are written to local-judge-results.jsonl and never overwrite an API run.

Pilot analyze options:
  --results-file <name>          Result JSONL inside the pilot directory (default: judge-results.jsonl)
  --output-prefix <name>         Prefix for generated analysis artifacts (default: pilot)

Compare options:
  --calibrate                    Calibrate machine verdicts using paired human labels
  --threshold <probability>      Decision threshold (default: 0.95)
  --min-effect <proportion>      Probability target is candidate improvement above this value
  --min-calibration-labels <n>   Required paired labels per policy (default: 10)
  --iterations <n>               Monte Carlo draws (default: 20000, minimum: 1000)
  --seed <n>                     Deterministic seed (default: 20260811)
  --json                         Emit machine-readable JSON

Certificate input:
  JSON containing frozen populationRows, disjoint auditRows and inferenceRows,
  alpha, practical-equivalence delta, and optional gate thresholds. The command
  always emits the complete machine-readable certificate.
`;

function required(values, name) {
  const value = values[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new UserError(`Missing required option --${name}`);
  }
  return value;
}

function numeric(values, name, fallback) {
  if (values[name] === undefined) return fallback;
  const value = Number(values[name]);
  if (!Number.isFinite(value)) throw new UserError(`--${name} must be a finite number`);
  return value;
}

function integer(values, name, fallback) {
  const value = numeric(values, name, fallback);
  if (!Number.isInteger(value)) throw new UserError(`--${name} must be an integer`);
  return value;
}

function parse(command, args) {
  const shared = { help: { type: "boolean", short: "h" }, json: { type: "boolean" } };
  const options = command === "compare"
    ? {
        ...shared,
        input: { type: "string" },
        baseline: { type: "string" },
        candidate: { type: "string" },
        calibrate: { type: "boolean" },
        threshold: { type: "string" },
        "min-effect": { type: "string" },
        "min-calibration-labels": { type: "string" },
        iterations: { type: "string" },
        seed: { type: "string" },
      }
    : command === "certify"
      ? { ...shared, input: { type: "string" } }
    : command === "audit-judge"
      ? { ...shared, input: { type: "string" }, "group-by": { type: "string" } }
      : command === "import-roboarena"
        ? { ...shared, "data-root": { type: "string" }, output: { type: "string" } }
        : command === "fetch-roboarena-metadata"
          ? { ...shared, target: { type: "string" } }
        : command === "pilot-create"
          ? {
              ...shared,
              input: { type: "string" },
              baseline: { type: "string" },
              candidate: { type: "string" },
              "output-dir": { type: "string" },
              sessions: { type: "string" },
              seed: { type: "string" },
            }
        : command === "pilot-download"
          ? { ...shared, "pilot-dir": { type: "string" }, concurrency: { type: "string" } }
        : command === "pilot-judge-local"
          ? {
              ...shared,
              "pilot-dir": { type: "string" },
              model: { type: "string" },
              endpoint: { type: "string" },
              frames: { type: "string" },
              "max-new": { type: "string" },
            }
        : command === "pilot-judge"
          ? {
              ...shared,
              "pilot-dir": { type: "string" },
              "max-new": { type: "string" },
              "max-requests": { type: "string" },
              "max-input-tokens": { type: "string" },
            }
        : command === "pilot-analyze"
          ? {
              ...shared,
              "pilot-dir": { type: "string" },
              "population-input": { type: "string" },
              "results-file": { type: "string" },
              "output-prefix": { type: "string" },
            }
        : shared;
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new UserError(error.message);
  }
}

async function runPilotCreate(args) {
  const values = parse("pilot-create", args);
  if (values.help) return console.log(HELP);
  const records = await readEvidence(required(values, "input"));
  const result = await createPilotFiles({
    records,
    baseline: required(values, "baseline"),
    candidate: required(values, "candidate"),
    outputDir: required(values, "output-dir"),
    sessions: integer(values, "sessions", 100),
    seed: integer(values, "seed", 20260811),
  });
  console.log(values.json ? JSON.stringify(result, null, 2) :
    `Frozen ${result.sampledSessions}-session/${result.sampledVideos}-video pilot in ${result.outputDir}\n` +
    `Population: ${result.populationSessions} matched sessions\nPrompt SHA-256: ${result.promptSha256}`);
}

async function runPilotDownload(args) {
  const values = parse("pilot-download", args);
  if (values.help) return console.log(HELP);
  const result = await downloadPilotVideos({
    pilotDir: required(values, "pilot-dir"),
    concurrency: integer(values, "concurrency", 4),
    onProgress: ({ stage, completed, total, totalBytes }) => {
      const size = totalBytes ? ` / ${(totalBytes / 1024 / 1024).toFixed(1)} MiB selected` : "";
      process.stderr.write(`${stage}: ${completed}/${total}${size}\n`);
    },
  });
  console.log(values.json ? JSON.stringify(result, null, 2) :
    `Downloaded ${result.videos} blinded wrist videos (${(result.bytes / 1024 / 1024).toFixed(1)} MiB) to ${result.pilotDir}`);
}

async function runPilotJudge(args) {
  const values = parse("pilot-judge", args);
  if (values.help) return console.log(HELP);
  const result = await runGeminiJudge({
    pilotDir: required(values, "pilot-dir"),
    maxNew: integer(values, "max-new", 200),
    maximumRequests: integer(values, "max-requests", 220),
    maximumInputTokens: integer(values, "max-input-tokens", 10000000),
    onProgress: ({ completed, total, inputTokens, requests }) => {
      if (completed % 5 === 0 || completed === total) {
        process.stderr.write(`judged: ${completed}/${total}; input tokens: ${inputTokens}; API requests: ${requests}\n`);
      }
    },
  });
  console.log(values.json ? JSON.stringify(result, null, 2) :
    `Judged ${result.completed}/${result.total} videos; estimated paid-tier cost $${result.estimatedPaidTierUsd.toFixed(4)}`);
}

async function runPilotJudgeLocal(args) {
  const values = parse("pilot-judge-local", args);
  if (values.help) return console.log(HELP);
  const started = Date.now();
  const result = await runLocalJudge({
    pilotDir: required(values, "pilot-dir"),
    model: required(values, "model"),
    endpoint: values.endpoint ?? "http://127.0.0.1:11434",
    frameCount: integer(values, "frames", 8),
    maxNew: values["max-new"] === undefined ? Number.POSITIVE_INFINITY : integer(values, "max-new", 0),
    onProgress: ({ completed, total, elapsedMs }) => {
      const minutes = (Date.now() - started) / 60000;
      process.stderr.write(
        `judged ${completed}/${total}  (${(elapsedMs / 1000).toFixed(1)}s this item, ${minutes.toFixed(1)} min elapsed)\n`,
      );
    },
  });
  console.log(values.json ? JSON.stringify(result, null, 2) :
    `Judged ${result.completed}/${result.total} videos with ${result.model}; ` +
    `${result.remaining} remaining; results in ${result.resultsFile}`);
}

async function runPilotAnalyze(args) {
  const values = parse("pilot-analyze", args);
  if (values.help) return console.log(HELP);
  const result = await analyzePilot({
    pilotDir: required(values, "pilot-dir"),
    populationInput: required(values, "population-input"),
    resultsFile: values["results-file"] ?? "judge-results.jsonl",
    outputPrefix: values["output-prefix"] ?? "pilot",
  });
  const summary = {
    judgments: result.judgments,
    machine: {
      mean: result.sample.machine.mean,
      probability_greater: result.sample.machine.probability_greater,
      decision: result.sample.machine.decision,
    },
    human: {
      mean: result.sample.human.mean,
      probability_greater: result.sample.human.probability_greater,
      decision: result.sample.human.decision,
    },
    signals: result.signals,
    exploratory_gate: result.exploratory_gate,
  };
  console.log(values.json ? JSON.stringify(result, null, 2) : JSON.stringify(summary, null, 2));
}

async function runFetch(args) {
  const values = parse("fetch-roboarena-metadata", args);
  if (values.help) return console.log(HELP);
  const result = await downloadRoboArenaMetadata({
    target: required(values, "target"),
    onProgress: ({ stage }) => {
      process.stderr.write(`${stage}...\n`);
    },
  });
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      `Downloaded ${result.sessionMetadataFiles} session metadata files to ${result.target}.\n` +
      `Media downloaded: no (${(result.bytes / 1024 / 1024).toFixed(1)} MiB metadata only).`,
    );
  }
}

async function runImport(args) {
  const values = parse("import-roboarena", args);
  if (values.help) return console.log(HELP);
  const dataRoot = values["data-root"] ?? process.env.ROBOEVAL_DATA_ROOT;
  if (!dataRoot) throw new UserError("Missing --data-root and ROBOEVAL_DATA_ROOT is not set");
  const result = await importRoboArena({
    dataRoot,
    output: required(values, "output"),
    onProgress: ({ sessionCount, recordCount }) => {
      process.stderr.write(`Imported ${sessionCount} sessions / ${recordCount} policy episodes\r`);
    },
  });
  if (result.sessionCount >= 250) process.stderr.write("\n");
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(
      `Imported ${result.recordCount} policy episodes from ${result.sessionCount} sessions.\n` +
      `Single-policy sessions retained: ${result.singlePolicySessions}; records without human outcome: ` +
      `${result.recordsWithoutHumanOutcome}.\n` +
      `Source remained read-only: ${result.dataRoot}\nOutput: ${result.output}`,
    );
  }
}

async function runCompare(args) {
  const values = parse("compare", args);
  if (values.help) return console.log(HELP);
  const records = await readEvidence(required(values, "input"));
  const result = comparePolicies(records, {
    baseline: required(values, "baseline"),
    candidate: required(values, "candidate"),
    calibrate: values.calibrate ?? false,
    threshold: numeric(values, "threshold", 0.95),
    minEffect: numeric(values, "min-effect", 0),
    minimumCalibrationLabels: integer(values, "min-calibration-labels", 10),
    iterations: integer(values, "iterations", 20000),
    seed: integer(values, "seed", 20260811),
  });
  console.log(values.json ? JSON.stringify(result, null, 2) : formatComparison(result));
}

async function runCertificate(args) {
  const values = parse("certify", args);
  if (values.help) return console.log(HELP);
  const input = await readJson(required(values, "input"), "certificate frame");
  const result = certifyPolicyGraph(input);
  console.log(JSON.stringify(result, null, 2));
}

async function runAudit(args) {
  const values = parse("audit-judge", args);
  if (values.help) return console.log(HELP);
  const records = await readEvidence(required(values, "input"));
  const groupBy = (values["group-by"] ?? "policy")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const result = auditJudge(records, groupBy);
  console.log(values.json ? JSON.stringify(result, null, 2) : formatAudit(result));
}

export async function run(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }
  if (command === "import-roboarena") return runImport(args);
  if (command === "fetch-roboarena-metadata") return runFetch(args);
  if (command === "pilot-create") return runPilotCreate(args);
  if (command === "pilot-download") return runPilotDownload(args);
  if (command === "pilot-judge") return runPilotJudge(args);
  if (command === "pilot-judge-local") return runPilotJudgeLocal(args);
  if (command === "pilot-analyze") return runPilotAnalyze(args);
  if (command === "compare") return runCompare(args);
  if (command === "certify") return runCertificate(args);
  if (command === "audit-judge") return runAudit(args);
  throw new UserError(`Unknown command: ${command}\n\n${HELP}`);
}

export async function main(argv = process.argv.slice(2)) {
  try {
    await run(argv);
  } catch (error) {
    if (error instanceof UserError) {
      process.stderr.write(`ERROR: ${error.message}\n`);
      if (error.details) process.stderr.write(`DETAIL: ${error.details}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  }
}
