import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { UserError } from "./errors.js";
import { validateEvidenceRecord } from "./evidence.js";

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "" || value === "null" || value === "~") return null;
  if ((value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))) {
    const body = value.slice(1, -1);
    return value.startsWith("'") ? body.replaceAll("''", "'") : body.replaceAll('\\"', '"');
  }
  if (/^-?(?:\d+\.?\d*|\.\d+)$/u.test(value)) return Number(value);
  if (/^(?:true|false)$/iu.test(value)) return value.toLowerCase() === "true";
  return value;
}

function yamlEntry(line) {
  const match = /^(\s*)([^:#][^:]*):(?:\s*(.*))?$/u.exec(line);
  if (!match) return null;
  return { indent: match[1].length, key: match[2].trim(), rawValue: match[3] ?? "" };
}

// Deliberately parses only the documented RoboArena metadata shape. A general YAML
// parser would add a production dependency; unsupported shapes fail visibly below.
export function parseRoboArenaMetadata(text, metadataPath = "metadata.yaml") {
  const session = {};
  const policies = {};
  let inPolicies = false;
  let currentLabel = null;

  for (const line of text.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const entry = yamlEntry(line);
    if (!entry) continue;

    if (entry.indent === 0 && entry.key === "policies" && entry.rawValue.trim() === "") {
      inPolicies = true;
      currentLabel = null;
      continue;
    }
    if (entry.indent === 0) {
      inPolicies = false;
      currentLabel = null;
      session[entry.key] = parseScalar(entry.rawValue);
      continue;
    }
    if (!inPolicies) continue;
    if (entry.indent === 2 && entry.rawValue.trim() === "") {
      currentLabel = entry.key;
      policies[currentLabel] = {};
      continue;
    }
    if (currentLabel && entry.indent >= 4) {
      policies[currentLabel][entry.key] = parseScalar(entry.rawValue);
    }
  }

  const policyEntries = Object.entries(policies);
  if (policyEntries.length === 0) {
    throw new UserError(`${metadataPath}: expected at least one policy in RoboArena metadata`);
  }
  for (const [label, policy] of policyEntries) {
    if (typeof policy.policy_name !== "string" || policy.policy_name.trim() === "") {
      throw new UserError(`${metadataPath}: policy ${label} has no policy_name`);
    }
  }
  return { ...session, policies };
}

async function ensureDatasetRoot(dataRoot) {
  const resolved = path.resolve(dataRoot);
  try {
    if (!(await stat(resolved)).isDirectory()) throw new Error("not a directory");
    await access(path.join(resolved, "evaluation_sessions"));
    await access(path.join(resolved, "global_metadata.yaml"));
  } catch (error) {
    throw new UserError(
      `Not a RoboArena dump root: ${resolved}. Expected global_metadata.yaml and evaluation_sessions/.`,
      error.message,
    );
  }
  return resolved;
}

function portableRelative(from, target) {
  return path.relative(from, target).split(path.sep).join("/");
}

async function videoPathsForPolicy(datasetRoot, sessionDir, label) {
  const entries = await readdir(sessionDir, { withFileTypes: true });
  const policyDirectory = entries.find((entry) => entry.isDirectory() && entry.name.startsWith(`${label}_`));
  if (!policyDirectory) return [];
  const policyPath = path.join(sessionDir, policyDirectory.name);
  const files = await readdir(policyPath, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp4"))
    .map((entry) => portableRelative(datasetRoot, path.join(policyPath, entry.name)))
    .sort();
}

export async function importRoboArena({ dataRoot, output, onProgress = undefined }) {
  const root = await ensureDatasetRoot(dataRoot);
  const outputPath = path.resolve(output);
  const sessionsPath = path.join(root, "evaluation_sessions");
  const sessionEntries = (await readdir(sessionsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  if (sessionEntries.length === 0) throw new UserError("RoboArena dump contains no evaluation sessions");

  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  const stream = createWriteStream(temporaryPath, { encoding: "utf8", flags: "wx" });
  let recordCount = 0;
  let sessionCount = 0;
  let singlePolicySessions = 0;
  let recordsWithoutHumanOutcome = 0;

  try {
    for (const entry of sessionEntries) {
      const sessionDir = path.join(sessionsPath, entry.name);
      const metadataPath = path.join(sessionDir, "metadata.yaml");
      let metadataText;
      try {
        metadataText = await readFile(metadataPath, "utf8");
      } catch (error) {
        throw new UserError(`${portableRelative(root, metadataPath)}: cannot read metadata`, error.message);
      }
      const metadata = parseRoboArenaMetadata(metadataText, portableRelative(root, metadataPath));
      if (Object.keys(metadata.policies).length === 1) singlePolicySessions += 1;
      for (const [label, policy] of Object.entries(metadata.policies)) {
        const binarySuccess = policy.binary_success === 0 || policy.binary_success === 1
          ? Boolean(policy.binary_success)
          : null;
        const partialSuccess = typeof policy.partial_success === "number"
          ? Math.min(1, Math.max(0, policy.partial_success))
          : null;
        const record = validateEvidenceRecord({
          schema_version: 1,
          trial_id: `${entry.name}:${label}`,
          comparison_id: entry.name,
          policy: policy.policy_name,
          task: typeof metadata.language_instruction === "string" && metadata.language_instruction.trim()
            ? metadata.language_instruction.trim()
            : "unknown",
          site: typeof metadata.evaluation_location === "string" && metadata.evaluation_location.trim()
            ? metadata.evaluation_location.trim()
            : "unknown",
          timestamp: metadata.session_completion_timestamp ?? metadata.session_creation_timestamp ?? null,
          automatic_judge: null,
          human: binarySuccess === null && partialSuccess === null ? null : {
            score: partialSuccess,
            success: binarySuccess,
            source: "roboarena-evaluator",
          },
          session_preference: metadata.preference ?? null,
          video_paths: await videoPathsForPolicy(root, sessionDir, label),
          source: {
            dataset: path.basename(root),
            metadata_path: portableRelative(root, metadataPath),
          },
        });
        if (record.human === null) recordsWithoutHumanOutcome += 1;
        if (!stream.write(`${JSON.stringify(record)}\n`)) await once(stream, "drain");
        recordCount += 1;
      }
      sessionCount += 1;
      if (onProgress && sessionCount % 250 === 0) onProgress({ sessionCount, recordCount });
    }
    stream.end();
    await once(stream, "finish");
    await rename(temporaryPath, outputPath);
  } catch (error) {
    stream.destroy();
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return {
    dataRoot: root,
    output: outputPath,
    sessionCount,
    recordCount,
    singlePolicySessions,
    recordsWithoutHumanOutcome,
  };
}
