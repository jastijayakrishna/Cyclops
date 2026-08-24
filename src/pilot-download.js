import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { UserError } from "./errors.js";
import { readJson, writeJsonAtomic } from "./json-files.js";

const REPOSITORY_ID = "RoboArena/DataDump_07-17-2026";
const REVISION = "main";
const MAX_INLINE_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

function repositoryRoot() {
  const pathname = new URL("..", import.meta.url).pathname.replace(
    /^\/(?:[A-Za-z]:)/u,
    (match) => match.slice(1),
  );
  return path.resolve(pathname);
}

function assertExternal(directory) {
  const resolved = path.resolve(directory);
  const relative = path.relative(repositoryRoot(), resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new UserError(`Pilot media must remain outside this Git repository: ${resolved}`);
  }
  return resolved;
}

async function fetchWithRetry(url, options = {}, attempts = 8) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { "user-agent": "roboeval/0.2", ...(options.headers ?? {}) },
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      if (response.status < 500 && response.status !== 429) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      const delay = Number.isFinite(retryAfter)
        ? Math.min(30000, Math.max(1000, retryAfter * 1000))
        : Math.min(30000, 500 * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(15000, 500 * 2 ** (attempt - 1))));
      }
    }
  }
  throw new UserError(`Hugging Face request failed: ${url}`, lastError?.message);
}

function nextPage(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = /<([^>]+)>;\s*rel="next"/u.exec(part);
    if (match) return match[1];
  }
  return null;
}

async function listSessionFiles(sessionId) {
  let url = `https://huggingface.co/api/datasets/${REPOSITORY_ID}/tree/${REVISION}/` +
    `evaluation_sessions/${encodeURIComponent(sessionId)}?recursive=true&expand=false&limit=1000`;
  const files = [];
  do {
    const response = await fetchWithRetry(url);
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new UserError(`Unexpected tree response for session ${sessionId}`);
    files.push(...entries.filter((entry) => entry.type === "file"));
    url = nextPage(response.headers.get("link"));
  } while (url);
  return files;
}

function resolveWristFile(item, entries) {
  const prefix = `evaluation_sessions/${item.comparison_id}/`;
  const matches = entries.filter((entry) => {
    if (!entry.path.startsWith(prefix)) return false;
    const relative = entry.path.slice(prefix.length);
    const slash = relative.indexOf("/");
    if (slash < 0) return false;
    const directory = relative.slice(0, slash);
    const filename = relative.slice(slash + 1);
    return directory.startsWith(`${item.source_label}_`) && /(?:video_)?wrist\.mp4$/iu.test(filename);
  });
  if (matches.length !== 1) {
    throw new UserError(
      `Expected one wrist video for ${item.comparison_id}:${item.source_label}, found ${matches.length}`,
    );
  }
  const entry = matches[0];
  const size = Number(entry.lfs?.size ?? entry.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw new UserError(`Wrist video has invalid size metadata: ${entry.path}`);
  }
  return { source_path: entry.path, size };
}

function rawUrl(sourcePath) {
  const encoded = sourcePath.split("/").map(encodeURIComponent).join("/");
  return `https://huggingface.co/datasets/${REPOSITORY_ID}/resolve/${REVISION}/${encoded}`;
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadVideo(pilotDir, item) {
  const videoDirectory = path.join(pilotDir, "videos");
  await mkdir(videoDirectory, { recursive: true });
  const destination = path.join(videoDirectory, `${item.item_id}.mp4`);
  try {
    const existing = await stat(destination);
    if (existing.isFile() && existing.size === item.size) {
      return { ...item, local_path: `videos/${item.item_id}.mp4`, sha256: await sha256(destination), reused: true };
    }
    throw new UserError(`Existing pilot video has unexpected size: ${destination}`);
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (error.code !== "ENOENT") throw error;
  }

  const response = await fetchWithRetry(rawUrl(item.source_path));
  const temporary = `${destination}.tmp-${process.pid}`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: "wx" }));
  const downloaded = await stat(temporary);
  if (downloaded.size !== item.size) {
    throw new UserError(
      `Downloaded size mismatch for ${item.source_path}: expected ${item.size}, received ${downloaded.size}`,
    );
  }
  await rename(temporary, destination);
  return { ...item, local_path: `videos/${item.item_id}.mp4`, sha256: await sha256(destination), reused: false };
}

export async function downloadPilotVideos({ pilotDir, concurrency = 4, onProgress = undefined }) {
  const resolved = assertExternal(pilotDir);
  const analysis = await readJson(path.join(resolved, "analysis-key.json"), "pilot analysis key");
  const tasks = await readJson(path.join(resolved, "judge-tasks.json"), "pilot judge tasks");
  if (!Array.isArray(analysis.items) || !Array.isArray(tasks.items) || analysis.items.length !== tasks.items.length) {
    throw new UserError("Pilot analysis key and judge tasks have inconsistent item counts");
  }
  const taskMap = new Map(tasks.items.map((item) => [item.item_id, item]));
  const bySession = new Map();
  for (const item of analysis.items) {
    let sessionItems = bySession.get(item.comparison_id);
    if (!sessionItems) {
      sessionItems = [];
      bySession.set(item.comparison_id, sessionItems);
    }
    sessionItems.push(item);
  }

  const resolvedItems = [];
  let listed = 0;
  const sessionEntries = [...bySession.entries()];
  let nextSession = 0;
  const listingWorkers = Array.from({ length: Math.min(concurrency, sessionEntries.length) }, async () => {
    for (;;) {
      const index = nextSession;
      nextSession += 1;
      if (index >= sessionEntries.length) return;
      const [sessionId, items] = sessionEntries[index];
      const entries = await listSessionFiles(sessionId);
      for (const item of items) {
        const task = taskMap.get(item.item_id);
        if (!task) throw new UserError(`Judge task missing for item ${item.item_id}`);
        resolvedItems.push({
          item_id: item.item_id,
          instruction: task.instruction,
          ...resolveWristFile(item, entries),
        });
      }
      listed += 1;
      if (listed % 10 === 0 || listed === sessionEntries.length) {
        onProgress?.({ stage: "listing", completed: listed, total: sessionEntries.length });
      }
    }
  });
  await Promise.all(listingWorkers);
  resolvedItems.sort((left, right) => left.item_id.localeCompare(right.item_id));

  const oversized = resolvedItems.filter((item) => item.size > MAX_INLINE_VIDEO_BYTES);
  const totalBytes = resolvedItems.reduce((sum, item) => sum + item.size, 0);
  if (oversized.length > 0) {
    throw new UserError(
      `${oversized.length} selected videos exceed the frozen 20 MiB inline-input limit; File API use requires a protocol amendment.`,
    );
  }
  if (totalBytes > MAX_TOTAL_VIDEO_BYTES) {
    throw new UserError(`Selected media totals ${(totalBytes / 1024 / 1024).toFixed(1)} MiB, over the 2 GiB pilot cap`);
  }

  const downloadedItems = [];
  let nextItem = 0;
  let completed = 0;
  const downloadWorkers = Array.from({ length: Math.min(concurrency, resolvedItems.length) }, async () => {
    for (;;) {
      const index = nextItem;
      nextItem += 1;
      if (index >= resolvedItems.length) return;
      downloadedItems.push(await downloadVideo(resolved, resolvedItems[index]));
      completed += 1;
      if (completed % 10 === 0 || completed === resolvedItems.length) {
        onProgress?.({ stage: "downloading", completed, total: resolvedItems.length, totalBytes });
      }
    }
  });
  await Promise.all(downloadWorkers);
  downloadedItems.sort((left, right) => left.item_id.localeCompare(right.item_id));
  const index = {
    index_version: 1,
    repository: REPOSITORY_ID,
    revision: REVISION,
    total_videos: downloadedItems.length,
    total_bytes: totalBytes,
    videos: downloadedItems.map(({ reused: _reused, ...item }) => item),
  };
  await writeJsonAtomic(path.join(resolved, "video-index.json"), index);
  return {
    pilotDir: resolved,
    videos: index.total_videos,
    bytes: index.total_bytes,
    reused: downloadedItems.filter((item) => item.reused).length,
  };
}

