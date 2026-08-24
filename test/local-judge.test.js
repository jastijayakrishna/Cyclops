import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultTransport, frameTimestamps, parseLocalVerdict, runLocalJudge } from "../src/local-judge.js";
import { promptHash } from "../src/judge-prompt.js";

const LOCAL_MODEL = "qwen2.5vl:7b";

function verdictText(overrides = {}) {
  return JSON.stringify({
    verdict: "FAILURE",
    confidence: 0.8,
    partial_success: 0.1,
    reason_code: "NO_PROGRESS",
    evidence: "The gripper hovers and never contacts the object.",
    ...overrides,
  });
}

async function fixture(root, { videos = 2 } = {}) {
  const pilot = path.join(root, "pilot");
  await mkdir(path.join(pilot, "videos"), { recursive: true });
  const items = Array.from({ length: videos }, (_, index) => ({
    item_id: `item-${index}`,
    instruction: `do thing ${index}`,
    local_path: `videos/item-${index}.mp4`,
    sha256: `hash-${index}`,
  }));
  for (const item of items) await writeFile(path.join(pilot, item.local_path), `video-${item.item_id}`);
  await Promise.all([
    writeFile(path.join(pilot, "judge-tasks.json"),
      JSON.stringify({ items: items.map((i) => ({ item_id: i.item_id, instruction: i.instruction })) })),
    writeFile(path.join(pilot, "video-index.json"),
      JSON.stringify({ total_videos: items.length, videos: items })),
    writeFile(path.join(pilot, "protocol.json"),
      JSON.stringify({ baseline: "a", candidate: "b", judge: { model: LOCAL_MODEL, prompt_sha256: promptHash() } })),
  ]);
  return { pilot, items };
}

// Frames are extracted from the real file, so tests inject a stub extractor and a
// stub transport instead of requiring ffmpeg and a running model server.
function stubs({ text = verdictText(), calls = [] } = {}) {
  return {
    extractFrames: async ({ videoPath, frameCount }) => {
      calls.push({ kind: "extract", videoPath, frameCount });
      return Array.from({ length: frameCount }, (_, i) => Buffer.from(`frame-${i}`).toString("base64"));
    },
    transport: async (payload) => {
      calls.push({ kind: "request", payload });
      return { text: typeof text === "function" ? text(payload) : text, model: LOCAL_MODEL };
    },
  };
}

test("spreads frame timestamps across the clip without hitting the endpoints", () => {
  const stamps = frameTimestamps({ duration: 40, frameCount: 8 });
  assert.equal(stamps.length, 8);
  assert.ok(stamps[0] > 0, "first frame should not be at t=0");
  assert.ok(stamps.at(-1) < 40, "last frame should not be at the final instant");
  for (let i = 1; i < stamps.length; i += 1) assert.ok(stamps[i] > stamps[i - 1], "timestamps must increase");
});

test("falls back to a single frame for a zero-length clip", () => {
  assert.equal(frameTimestamps({ duration: 0, frameCount: 8 }).length, 1);
});

test("parses a bare JSON verdict and a fenced one identically", () => {
  const bare = parseLocalVerdict(verdictText());
  const fenced = parseLocalVerdict("```json\n" + verdictText() + "\n```");
  assert.deepEqual(bare, fenced);
  assert.equal(bare.verdict, "FAILURE");
});

test("parses a verdict surrounded by model chatter", () => {
  const parsed = parseLocalVerdict(`Here is my assessment:\n${verdictText({ verdict: "SUCCESS" })}\nHope that helps.`);
  assert.equal(parsed.verdict, "SUCCESS");
});

test("rejects an out-of-enum reason code and an overlong evidence string", () => {
  assert.throws(() => parseLocalVerdict(verdictText({ reason_code: "VIBES" })), /reason_code/u);
  assert.throws(() => parseLocalVerdict(verdictText({ evidence: "x".repeat(601) })), /evidence/u);
});

test("rejects a confidence outside zero and one", () => {
  assert.throws(() => parseLocalVerdict(verdictText({ confidence: 1.4 })), /confidence/u);
});

// Small models emit FAILURE alongside confidence 0, which literally asserts zero
// confidence in the verdict just given. Scored as P(success) = 1 - confidence,
// that becomes a maximum-success score attached to a failure verdict and would
// silently invert calibration, so a self-contradictory pair is rejected.
test("rejects a verdict that contradicts its own confidence", () => {
  assert.throws(() => parseLocalVerdict(verdictText({ verdict: "FAILURE", confidence: 0 })), /contradicts/u);
  assert.throws(() => parseLocalVerdict(verdictText({ verdict: "SUCCESS", confidence: 0.2 })), /contradicts/u);
});

test("accepts a verdict whose confidence agrees with it", () => {
  assert.equal(parseLocalVerdict(verdictText({ verdict: "FAILURE", confidence: 0.9 })).confidence, 0.9);
  assert.equal(parseLocalVerdict(verdictText({ verdict: "SUCCESS", confidence: 0.75 })).verdict, "SUCCESS");
});

test("a scored verdict never disagrees in direction with its own label", () => {
  for (const [verdict, confidence] of [["SUCCESS", 0.9], ["FAILURE", 0.8], ["SUCCESS", 0.51]]) {
    const parsed = parseLocalVerdict(verdictText({ verdict, confidence }));
    const score = parsed.verdict === "SUCCESS" ? parsed.confidence : 1 - parsed.confidence;
    assert.equal(score > 0.5, parsed.verdict === "SUCCESS", `${verdict}@${confidence} scored ${score}`);
  }
});

test("judges every video and writes one result line each", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-judge-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { pilot } = await fixture(root, { videos: 3 });
  const calls = [];
  const { extractFrames, transport } = stubs({ calls });

  const result = await runLocalJudge({
    pilotDir: pilot, model: LOCAL_MODEL, frameCount: 4, extractFrames, transport, verifyHashes: false,
  });

  assert.equal(result.completed, 3);
  assert.equal(result.newResults, 3);
  const lines = (await readFile(path.join(pilot, "local-judge-results.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 3);
  const parsed = lines.map((line) => JSON.parse(line));
  assert.deepEqual(parsed.map((row) => row.item_id).sort(), ["item-0", "item-1", "item-2"]);
  for (const row of parsed) {
    assert.equal(row.model, LOCAL_MODEL);
    assert.equal(row.prompt_sha256, promptHash());
    assert.equal(row.success, false);
    assert.equal(row.frame_count, 4);
    assert.equal(typeof row.automatic_score, "number");
  }
  assert.equal(calls.filter((c) => c.kind === "extract").length, 3);
});

test("resumes without re-judging completed items", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-judge-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { pilot } = await fixture(root, { videos: 3 });
  const first = stubs({ calls: [] });
  await runLocalJudge({ pilotDir: pilot, model: LOCAL_MODEL, frameCount: 2, ...first, verifyHashes: false, maxNew: 2 });

  const calls = [];
  const second = stubs({ calls });
  const result = await runLocalJudge({
    pilotDir: pilot, model: LOCAL_MODEL, frameCount: 2, ...second, verifyHashes: false,
  });

  assert.equal(result.newResults, 1);
  assert.equal(result.completed, 3);
  assert.equal(calls.filter((c) => c.kind === "request").length, 1);
});

test("refuses to mix results from a different model or prompt", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-judge-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { pilot } = await fixture(root, { videos: 2 });
  await writeFile(path.join(pilot, "local-judge-results.jsonl"),
    `${JSON.stringify({ item_id: "item-0", model: "some-other-model", prompt_sha256: promptHash(), success: true })}\n`);

  await assert.rejects(
    () => runLocalJudge({ pilotDir: pilot, model: LOCAL_MODEL, frameCount: 2, ...stubs(), verifyHashes: false }),
    /different judge contract/u,
  );
});

test("stops at the frozen maximum and can be resumed later", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-judge-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { pilot } = await fixture(root, { videos: 5 });
  const result = await runLocalJudge({
    pilotDir: pilot, model: LOCAL_MODEL, frameCount: 2, ...stubs(), verifyHashes: false, maxNew: 2,
  });
  assert.equal(result.newResults, 2);
  assert.equal(result.remaining, 3);
});

test("fails the item when the model never returns parseable JSON", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-judge-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { pilot } = await fixture(root, { videos: 1 });
  await assert.rejects(
    () => runLocalJudge({
      pilotDir: pilot, model: LOCAL_MODEL, frameCount: 2, verifyHashes: false,
      extractFrames: stubs().extractFrames,
      transport: async () => ({ text: "I cannot tell what is happening.", model: LOCAL_MODEL }),
    }),
    /no parseable JSON verdict/u,
  );
});

// Eight 448px frames cost about 4,300 tokens, which overflows Ollama's 4,096
// default and fails the whole request, so the context window must be sized for
// the frame budget rather than left at the server default.
test("requests a context window large enough for the frames it sends", async (context) => {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    seen.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ response: verdictText(), model: LOCAL_MODEL }) };
  };
  context.after(() => { globalThis.fetch = original; });

  await defaultTransport({
    endpoint: "http://127.0.0.1:11434",
    model: LOCAL_MODEL,
    prompt: "p",
    images: Array.from({ length: 8 }, (_, i) => `img${i}`),
  });

  const body = seen[0].body;
  assert.ok(body.options.num_ctx >= 8192, `num_ctx was ${body.options.num_ctx}`);
  assert.equal(body.options.temperature, 0);
  assert.equal(body.images.length, 8);
  assert.match(seen[0].url, /\/api\/generate$/u);
});

// Left to free-form JSON, a small model invents its own field names ("success"
// instead of "verdict", no reason_code). Sending the response schema as `format`
// constrains decoding to the frozen contract.
test("constrains decoding with the frozen response schema, not free-form JSON", async (context) => {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    seen.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ response: verdictText(), model: LOCAL_MODEL }) };
  };
  context.after(() => { globalThis.fetch = original; });

  await defaultTransport({ endpoint: "http://127.0.0.1:11434", model: LOCAL_MODEL, prompt: "p", images: ["a"] });

  const format = seen[0].format;
  assert.notEqual(format, "json", "free-form json lets the model rename fields");
  assert.equal(format.type, "object");
  assert.deepEqual(
    format.required.sort(),
    ["confidence", "evidence", "partial_success", "reason_code", "verdict"],
  );
  assert.deepEqual(format.properties.verdict.enum, ["SUCCESS", "FAILURE"]);
});

test("allows the context window to be raised for a larger frame budget", async (context) => {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    seen.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ response: verdictText(), model: LOCAL_MODEL }) };
  };
  context.after(() => { globalThis.fetch = original; });

  await defaultTransport({
    endpoint: "http://127.0.0.1:11434", model: LOCAL_MODEL, prompt: "p", images: ["a"], contextTokens: 32768,
  });
  assert.equal(seen[0].options.num_ctx, 32768);
});

test("sends the frozen prompt and one image per frame", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "local-judge-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const { pilot } = await fixture(root, { videos: 1 });
  const calls = [];
  await runLocalJudge({
    pilotDir: pilot, model: LOCAL_MODEL, frameCount: 6, ...stubs({ calls }), verifyHashes: false,
  });
  const request = calls.find((c) => c.kind === "request").payload;
  assert.equal(request.images.length, 6);
  assert.equal(request.model, LOCAL_MODEL);
  assert.match(request.prompt, /do thing 0/u);
  assert.match(request.prompt, /blinded evaluator/u);
});
