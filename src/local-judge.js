import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { appendFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { UserError } from "./errors.js";
import { JUDGE_PROMPT_VERSION, JUDGE_RESPONSE_SCHEMA, judgePrompt, promptHash } from "./judge-prompt.js";
import { readJson } from "./json-files.js";

// Local open-weights judge.
//
// Runs the same frozen prompt and verdict contract as the hosted judge, against a
// model served on this machine, so no API call or credential is involved. Vision
// models take images rather than video, so each clip is reduced to uniformly
// spaced frames first.
//
// The transport and the frame extractor are injectable; the defaults talk to an
// Ollama-compatible endpoint and a bundled ffmpeg.

const execFileAsync = promisify(execFile);
const REASON_CODES = new Set(["COMPLETE", "NO_PROGRESS", "PARTIAL", "WRONG_ACTION", "NOT_VISIBLE", "ABORTED"]);
const RESULTS_FILE = "local-judge-results.jsonl";

export function frameTimestamps({ duration, frameCount }) {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const stamps = [];
  for (let index = 0; index < frameCount; index += 1) {
    // Midpoints of equal slices: never the first or last instant, which are often
    // black or mid-reset.
    stamps.push(duration * (index + 0.5) / frameCount);
  }
  return stamps;
}

function extractJsonObject(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(text);
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      continue;
    }
  }
  return null;
}

export function parseLocalVerdict(text) {
  const value = extractJsonObject(text);
  if (!value || typeof value !== "object") {
    throw new UserError(`Model returned no parseable JSON verdict: ${String(text).slice(0, 200)}`);
  }
  if (value.verdict !== "SUCCESS" && value.verdict !== "FAILURE") {
    throw new UserError(`Model returned an invalid verdict: ${JSON.stringify(value.verdict)}`);
  }
  for (const field of ["confidence", "partial_success"]) {
    const number = value[field];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1) {
      throw new UserError(`Model returned invalid ${field}: ${JSON.stringify(number)}`);
    }
  }
  if (!REASON_CODES.has(value.reason_code)) {
    throw new UserError(`Model returned invalid reason_code: ${JSON.stringify(value.reason_code)}`);
  }
  if (typeof value.evidence !== "string" || value.evidence.trim() === "" || value.evidence.length > 600) {
    throw new UserError("Model returned missing or overlong evidence");
  }
  // The score is read as P(success) = verdict === SUCCESS ? confidence : 1 - confidence.
  // Confidence below 0.5 therefore places the score on the opposite side of the
  // verdict the model just gave, which would invert the label downstream.
  if (value.confidence < 0.5) {
    throw new UserError(
      `Model returned a verdict that contradicts its own confidence: ` +
      `${value.verdict} with confidence ${value.confidence} scores as ` +
      `P(success)=${value.verdict === "SUCCESS" ? value.confidence : 1 - value.confidence}`,
    );
  }
  return value;
}

async function ffmpegPath() {
  try {
    const { stdout } = await execFileAsync("python", [
      "-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())",
    ]);
    return stdout.trim();
  } catch (error) {
    throw new UserError("Cannot locate ffmpeg; install it with: python -m pip install imageio-ffmpeg", error.message);
  }
}

async function probeDuration(ffmpeg, videoPath) {
  try {
    await execFileAsync(ffmpeg, ["-i", videoPath]);
    return 0;
  } catch (error) {
    const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/u.exec(error.stderr ?? "");
    if (!match) return 0;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
}

export async function defaultExtractFrames({ videoPath, frameCount, width = 448 }) {
  const ffmpeg = await ffmpegPath();
  const duration = await probeDuration(ffmpeg, videoPath);
  const stamps = frameTimestamps({ duration, frameCount });
  const frames = [];
  for (const stamp of stamps) {
    const { stdout } = await execFileAsync(ffmpeg, [
      "-ss", stamp.toFixed(3), "-i", videoPath,
      "-frames:v", "1", "-vf", `scale=${width}:-2`,
      "-f", "image2", "-c:v", "mjpeg", "-",
    ], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
    if (stdout.length > 0) frames.push(stdout.toString("base64"));
  }
  if (frames.length === 0) throw new UserError(`ffmpeg produced no frames for ${videoPath}`);
  return frames;
}

// Each 448px frame costs roughly 500 tokens, so eight frames plus the prompt
// overflow Ollama's 4,096 default and the server rejects the whole request.
const TOKENS_PER_FRAME = 600;
const CONTEXT_FLOOR = 8192;

export function contextWindowFor(frameCount) {
  return Math.max(CONTEXT_FLOOR, 2 ** Math.ceil(Math.log2(frameCount * TOKENS_PER_FRAME + 1024)));
}

export async function defaultTransport({ endpoint, model, prompt, images, timeoutMs = 300000, contextTokens = undefined }) {
  const response = await fetch(`${endpoint.replace(/\/$/u, "")}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      prompt,
      images,
      stream: false,
      format: JUDGE_RESPONSE_SCHEMA,
      options: {
        temperature: 0,
        num_predict: 300,
        num_ctx: contextTokens ?? contextWindowFor(images.length),
      },
    }),
  });
  if (!response.ok) {
    throw new UserError(`Local model endpoint returned HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  }
  const body = await response.json();
  return { text: body.response ?? "", model: body.model ?? model, evalCount: body.eval_count ?? null };
}

async function readJsonLinesIfPresent(filePath) {
  try {
    return (await readFile(filePath, "utf8")).split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function sha256(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

export async function runLocalJudge({
  pilotDir,
  model,
  endpoint = "http://127.0.0.1:11434",
  frameCount = 8,
  maxNew = Number.POSITIVE_INFINITY,
  verifyHashes = true,
  extractFrames = defaultExtractFrames,
  transport = defaultTransport,
  onProgress = undefined,
}) {
  const resolved = path.resolve(pilotDir);
  if (!model) throw new UserError("A local judge model name is required");
  const tasks = await readJson(path.join(resolved, "judge-tasks.json"), "judge tasks");
  const videoIndex = await readJson(path.join(resolved, "video-index.json"), "video index");
  const taskMap = new Map(tasks.items.map((item) => [item.item_id, item]));
  const resultPath = path.join(resolved, RESULTS_FILE);

  const existing = await readJsonLinesIfPresent(resultPath);
  const completed = new Set();
  for (const row of existing) {
    if (row.model !== model || row.prompt_sha256 !== promptHash()) {
      throw new UserError(`Existing result ${row.item_id} uses a different judge contract (${row.model})`);
    }
    if (completed.has(row.item_id)) throw new UserError(`Duplicate existing result: ${row.item_id}`);
    completed.add(row.item_id);
  }

  const pending = videoIndex.videos.filter((video) => !completed.has(video.item_id));
  const selected = Number.isFinite(maxNew) ? pending.slice(0, Math.max(0, maxNew)) : pending;
  let newResults = 0;

  for (const video of selected) {
    const task = taskMap.get(video.item_id);
    if (!task) throw new UserError(`Judge task missing for video ${video.item_id}`);
    const videoPath = path.join(resolved, ...video.local_path.split("/"));
    await stat(videoPath);
    if (verifyHashes && await sha256(videoPath) !== video.sha256) {
      throw new UserError(`Video hash mismatch: ${videoPath}`);
    }

    const images = await extractFrames({ videoPath, frameCount });
    const prompt = judgePrompt(task.instruction);
    const started = Date.now();
    const response = await transport({ endpoint, model, prompt, images });
    const parsed = parseLocalVerdict(response.text);
    const success = parsed.verdict === "SUCCESS";

    const result = {
      result_version: 1,
      item_id: video.item_id,
      model,
      model_version: response.model ?? model,
      runtime: "local",
      prompt_version: JUDGE_PROMPT_VERSION,
      prompt_sha256: promptHash(),
      frame_count: images.length,
      verdict: parsed.verdict,
      success,
      confidence: parsed.confidence,
      automatic_score: success ? parsed.confidence : 1 - parsed.confidence,
      partial_success: parsed.partial_success,
      reason_code: parsed.reason_code,
      evidence: parsed.evidence.trim(),
      elapsed_ms: Date.now() - started,
      judged_at: new Date().toISOString(),
    };
    await appendFile(resultPath, `${JSON.stringify(result)}\n`, "utf8");
    completed.add(video.item_id);
    newResults += 1;
    onProgress?.({ completed: completed.size, total: videoIndex.total_videos, elapsedMs: result.elapsed_ms });
  }

  return {
    pilotDir: resolved,
    model,
    completed: completed.size,
    total: videoIndex.total_videos,
    newResults,
    remaining: videoIndex.videos.length - completed.size,
    resultsFile: RESULTS_FILE,
  };
}
