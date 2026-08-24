import { readFile } from "node:fs/promises";
import { UserError } from "./errors.js";

function isNullableBoolean(value) {
  return value === null || value === undefined || typeof value === "boolean";
}

function isNullableFiniteNumber(value) {
  return value === null || value === undefined ||
    (typeof value === "number" && Number.isFinite(value));
}

export function automaticSuccess(record) {
  const judge = record.automatic_judge;
  if (!judge) return null;
  if (typeof judge.success === "boolean") return judge.success;
  if (typeof judge.score === "number" && Number.isFinite(judge.score)) {
    return judge.score >= 0.5;
  }
  return null;
}

export function humanSuccess(record) {
  return typeof record.human?.success === "boolean" ? record.human.success : null;
}

export function validateEvidenceRecord(record, lineNumber = undefined) {
  const where = lineNumber === undefined ? "record" : `line ${lineNumber}`;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new UserError(`${where}: expected a JSON object`);
  }
  if (record.schema_version !== 1) {
    throw new UserError(`${where}: unsupported schema_version ${JSON.stringify(record.schema_version)}`);
  }
  for (const field of ["trial_id", "comparison_id", "policy", "task", "site"]) {
    if (typeof record[field] !== "string" || record[field].trim() === "") {
      throw new UserError(`${where}: ${field} must be a non-empty string`);
    }
  }
  if (record.automatic_judge !== null && record.automatic_judge !== undefined) {
    if (typeof record.automatic_judge !== "object" ||
        !isNullableBoolean(record.automatic_judge.success) ||
        !isNullableFiniteNumber(record.automatic_judge.score)) {
      throw new UserError(`${where}: automatic_judge must contain nullable finite score/success values`);
    }
    const score = record.automatic_judge.score;
    if (score !== null && score !== undefined && (score < 0 || score > 1)) {
      throw new UserError(`${where}: automatic_judge.score must be between 0 and 1`);
    }
  }
  if (record.human !== null && record.human !== undefined) {
    if (typeof record.human !== "object" ||
        !isNullableBoolean(record.human.success) ||
        !isNullableFiniteNumber(record.human.score)) {
      throw new UserError(`${where}: human must contain nullable finite score/success values`);
    }
    const score = record.human.score;
    if (score !== null && score !== undefined && (score < 0 || score > 1)) {
      throw new UserError(`${where}: human.score must be between 0 and 1`);
    }
  }
  return record;
}

export async function readEvidence(path) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new UserError(`Cannot read evidence file: ${path}`, error.message);
  }
  const records = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.trim() === "") continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new UserError(`line ${index + 1}: invalid JSON`, error.message);
    }
    records.push(validateEvidenceRecord(record, index + 1));
  }
  if (records.length === 0) throw new UserError("Evidence file contains no records");
  return records;
}

export function matchedPairs(records, baseline, candidate, evidenceSelector) {
  if (baseline === candidate) throw new UserError("Baseline and candidate must be different policies");
  const comparisons = new Map();
  for (const record of records) {
    if (record.policy !== baseline && record.policy !== candidate) continue;
    let group = comparisons.get(record.comparison_id);
    if (!group) {
      group = new Map();
      comparisons.set(record.comparison_id, group);
    }
    if (group.has(record.policy)) {
      throw new UserError(
        `Comparison ${record.comparison_id} contains duplicate evidence for policy ${record.policy}`,
      );
    }
    group.set(record.policy, record);
  }
  const pairs = [];
  for (const [comparisonId, group] of comparisons) {
    const baselineRecord = group.get(baseline);
    const candidateRecord = group.get(candidate);
    if (!baselineRecord || !candidateRecord) continue;
    const baselineValue = evidenceSelector(baselineRecord);
    const candidateValue = evidenceSelector(candidateRecord);
    if (baselineValue === null || candidateValue === null) continue;
    pairs.push({
      comparison_id: comparisonId,
      baseline: baselineRecord,
      candidate: candidateRecord,
      baseline_value: baselineValue,
      candidate_value: candidateValue,
    });
  }
  return pairs;
}

