import { createHash } from "node:crypto";
import { appendFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { UserError } from "./errors.js";
import {
  JUDGE_MODEL,
  JUDGE_PROMPT_VERSION,
  JUDGE_RESPONSE_SCHEMA,
  judgePrompt,
  promptHash,
} from "./judge-prompt.js";
import { readJson } from "./json-files.js";

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent`;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 120000;

function apiKey() {
  const value = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!value) throw new UserError("GEMINI_API_KEY or GOOGLE_API_KEY is required for the frozen judge run");
  return value;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

async function readJsonLinesIfPresent(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return text.split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new UserError(`${filePath}:${index + 1}: invalid JSON`, error.message);
      }
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function validateVerdict(value) {
  if (!value || typeof value !== "object") throw new UserError("Gemini returned a non-object verdict");
  if (value.verdict !== "SUCCESS" && value.verdict !== "FAILURE") {
    throw new UserError(`Gemini returned an invalid verdict: ${JSON.stringify(value.verdict)}`);
  }
  for (const field of ["confidence", "partial_success"]) {
    if (typeof value[field] !== "number" || !Number.isFinite(value[field]) || value[field] < 0 || value[field] > 1) {
      throw new UserError(`Gemini returned invalid ${field}: ${JSON.stringify(value[field])}`);
    }
  }
  const reasons = new Set(["COMPLETE", "NO_PROGRESS", "PARTIAL", "WRONG_ACTION", "NOT_VISIBLE", "ABORTED"]);
  if (!reasons.has(value.reason_code)) throw new UserError(`Gemini returned invalid reason_code: ${value.reason_code}`);
  if (typeof value.evidence !== "string" || value.evidence.trim() === "" || value.evidence.length > 600) {
    throw new UserError("Gemini returned missing or overlong visual evidence");
  }
  return value;
}

function responseText(response) {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((part) => typeof part.text === "string").map((part) => part.text).join("");
  if (!text) {
    const reason = response.candidates?.[0]?.finishReason ?? response.promptFeedback?.blockReason ?? "no candidate text";
    throw new UserError(`Gemini produced no verdict text: ${reason}`);
  }
  return text;
}

function durationMilliseconds(value) {
  const match = /^(\d+(?:\.\d+)?)s$/u.exec(value ?? "");
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

export function geminiRetryPolicy({ status, body, retryAfter }) {
  let error;
  try {
    error = JSON.parse(body)?.error;
  } catch {
    error = null;
  }
  const details = Array.isArray(error?.details) ? error.details : [];
  const violations = details.flatMap((detail) => Array.isArray(detail.violations) ? detail.violations : []);
  const isDailyQuota = violations.some((violation) => /perday|requestsperday/iu.test(violation.quotaId ?? ""));
  if (isDailyQuota) return { retry: false, delayMs: 0, reason: "daily-quota" };
  if (status < 500 && status !== 429) return { retry: false, delayMs: 0, reason: "non-retryable" };

  const headerDelay = retryAfter === null || retryAfter === "" ? null : Number(retryAfter);
  const retryInfoDelay = details
    .map((detail) => durationMilliseconds(detail.retryDelay))
    .find((delay) => delay !== null);
  const delayMs = headerDelay !== null && Number.isFinite(headerDelay)
    ? Math.max(1000, headerDelay * 1000)
    : retryInfoDelay ?? null;
  return { retry: true, delayMs, reason: status === 429 ? "rate-limit" : "server-error" };
}

async function countRequestLog(filePath) {
  return (await readJsonLinesIfPresent(filePath)).length;
}

async function requestGemini({ itemId, videoBase64, instruction, key, requestLog, requestState }) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    if (requestState.count >= requestState.maximum) {
      throw new UserError(`Frozen API request cap of ${requestState.maximum} reached`);
    }
    requestState.count += 1;
    await appendFile(requestLog, `${JSON.stringify({
      request_number: requestState.count,
      item_id: itemId,
      attempt,
      requested_at: new Date().toISOString(),
      model: JUDGE_MODEL,
      prompt_sha256: promptHash(),
    })}\n`, "utf8");

    let response;
    try {
      response = await fetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { inlineData: { mimeType: "video/mp4", data: videoBase64 } },
              { text: judgePrompt(instruction) },
            ],
          }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 256,
            thinkingConfig: { thinkingBudget: 0 },
            responseMimeType: "application/json",
            responseJsonSchema: JUDGE_RESPONSE_SCHEMA,
          },
        }),
      });
    } catch (error) {
      lastError = error;
      if (attempt < 6) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 1000 * 2 ** (attempt - 1))));
        continue;
      }
      break;
    }
    if (response.ok) return response.json();
    const body = await response.text();
    lastError = new Error(`HTTP ${response.status}: ${body.slice(0, 2000)}`);
    const retryPolicy = geminiRetryPolicy({
      status: response.status,
      body,
      retryAfter: response.headers.get("retry-after"),
    });
    if (!retryPolicy.retry) break;
    const delay = Math.min(30000, retryPolicy.delayMs ?? 1000 * 2 ** (attempt - 1));
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw new UserError(`Gemini request failed for item ${itemId}`, lastError?.message);
}

export async function runGeminiJudge({
  pilotDir,
  maxNew = 200,
  maximumRequests = 220,
  maximumInputTokens = 10000000,
  onProgress = undefined,
}) {
  const resolved = path.resolve(pilotDir);
  const protocol = await readJson(path.join(resolved, "protocol.json"), "pilot protocol");
  const tasks = await readJson(path.join(resolved, "judge-tasks.json"), "judge tasks");
  const videoIndex = await readJson(path.join(resolved, "video-index.json"), "video index");
  if (protocol.judge?.model !== JUDGE_MODEL || protocol.judge?.prompt_sha256 !== promptHash()) {
    throw new UserError("Pilot protocol judge model or prompt hash does not match this runner");
  }
  const taskMap = new Map(tasks.items.map((item) => [item.item_id, item]));
  const resultPath = path.join(resolved, "judge-results.jsonl");
  const requestLog = path.join(resolved, "api-request-log.jsonl");
  const existing = await readJsonLinesIfPresent(resultPath);
  const completed = new Set();
  let inputTokens = 0;
  let outputTokens = 0;
  for (const result of existing) {
    if (completed.has(result.item_id)) throw new UserError(`Duplicate existing judge result: ${result.item_id}`);
    if (result.model !== JUDGE_MODEL || result.prompt_sha256 !== promptHash()) {
      throw new UserError(`Existing result ${result.item_id} uses a different judge contract`);
    }
    completed.add(result.item_id);
    inputTokens += result.usage?.prompt_tokens ?? 0;
    outputTokens += result.usage?.output_tokens ?? 0;
  }
  const requestState = { count: await countRequestLog(requestLog), maximum: maximumRequests };
  const pending = videoIndex.videos.filter((video) => !completed.has(video.item_id));
  const selected = pending.slice(0, Math.max(0, maxNew));
  const key = apiKey();
  let newResults = 0;

  for (const video of selected) {
    if (inputTokens >= maximumInputTokens) {
      throw new UserError(
        `Frozen input-token cap of ${maximumInputTokens} reached after ${completed.size + newResults} judgments`,
      );
    }
    const task = taskMap.get(video.item_id);
    if (!task) throw new UserError(`Judge task missing for video ${video.item_id}`);
    const videoPath = path.join(resolved, ...video.local_path.split("/"));
    const info = await stat(videoPath);
    if (info.size > MAX_VIDEO_BYTES) throw new UserError(`Video exceeds 20 MiB inline cap: ${videoPath}`);
    if (await sha256(videoPath) !== video.sha256) throw new UserError(`Video hash mismatch: ${videoPath}`);
    const base64 = await readFile(videoPath, "base64");
    const response = await requestGemini({
      itemId: video.item_id,
      videoBase64: base64,
      instruction: task.instruction,
      key,
      requestLog,
      requestState,
    });
    let parsed;
    try {
      parsed = validateVerdict(JSON.parse(responseText(response)));
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError(`Gemini returned invalid JSON for item ${video.item_id}`, error.message);
    }
    const success = parsed.verdict === "SUCCESS";
    const usage = {
      prompt_tokens: response.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens: response.usageMetadata?.totalTokenCount ?? 0,
    };
    inputTokens += usage.prompt_tokens;
    outputTokens += usage.output_tokens;
    const result = {
      result_version: 1,
      item_id: video.item_id,
      model: JUDGE_MODEL,
      model_version: response.modelVersion ?? null,
      prompt_version: JUDGE_PROMPT_VERSION,
      prompt_sha256: promptHash(),
      verdict: parsed.verdict,
      success,
      confidence: parsed.confidence,
      automatic_score: success ? parsed.confidence : 1 - parsed.confidence,
      partial_success: parsed.partial_success,
      reason_code: parsed.reason_code,
      evidence: parsed.evidence.trim(),
      usage,
      judged_at: new Date().toISOString(),
    };
    await appendFile(resultPath, `${JSON.stringify(result)}\n`, "utf8");
    completed.add(video.item_id);
    newResults += 1;
    onProgress?.({
      completed: completed.size,
      total: videoIndex.total_videos,
      inputTokens,
      outputTokens,
      requests: requestState.count,
    });
  }

  return {
    pilotDir: resolved,
    completed: completed.size,
    total: videoIndex.total_videos,
    newResults,
    inputTokens,
    outputTokens,
    apiRequests: requestState.count,
    estimatedPaidTierUsd: inputTokens * 0.10 / 1000000 + outputTokens * 0.40 / 1000000,
  };
}
