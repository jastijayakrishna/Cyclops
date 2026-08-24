import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/u, (match) => match.slice(1)));
const skippedDirectories = new Set([".git", "node_modules", "coverage"]);
const forbiddenDirectories = new Set(["data", "datasets", ".data", ".external-data", "artifacts", "output"]);
const forbiddenExtensions = new Set([
  ".mp4", ".mov", ".avi", ".npz", ".npy", ".parquet", ".arrow", ".tar", ".tgz", ".zip",
]);
const maximumBytes = 5 * 1024 * 1024;
const violations = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skippedDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    const relative = path.relative(repositoryRoot, fullPath);
    if (entry.isDirectory()) {
      if (forbiddenDirectories.has(entry.name)) {
        violations.push(`${relative}: dataset/generated directory is inside the repository`);
        continue;
      }
      await walk(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    const extension = lower.endsWith(".tar.gz") ? ".tar" : path.extname(lower);
    if (forbiddenExtensions.has(extension)) {
      violations.push(`${relative}: raw dataset extension ${extension}`);
    }
    const info = await stat(fullPath);
    if (info.size > maximumBytes) {
      violations.push(`${relative}: ${(info.size / 1024 / 1024).toFixed(1)} MiB exceeds the 5 MiB repository limit`);
    }
  }
}

await walk(repositoryRoot);
if (violations.length > 0) {
  process.stderr.write(`DATA BOUNDARY FAILED\n${violations.map((item) => `- ${item}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  console.log("Data boundary passed: no raw payloads, dataset directories, or files over 5 MiB found.");
}

