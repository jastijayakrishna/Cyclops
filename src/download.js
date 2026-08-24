import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { UserError } from "./errors.js";

const REPOSITORY_ID = "RoboArena/DataDump_07-17-2026";
const REVISION = "main";
const REPOSITORY_URL = `https://huggingface.co/datasets/${REPOSITORY_ID}`;

function repositoryRoot() {
  const pathname = new URL("..", import.meta.url).pathname.replace(
    /^\/(?:[A-Za-z]:)/u,
    (match) => match.slice(1),
  );
  return path.resolve(pathname);
}

function assertExternalTarget(target) {
  const resolved = path.resolve(target);
  const relative = path.relative(repositoryRoot(), resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new UserError(`Metadata target must be outside this Git repository: ${resolved}`);
  }
  return resolved;
}

function runGit(args, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      env: { ...process.env, ...environment },
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let errorText = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      errorText = `${errorText}${chunk}`.slice(-12000);
    });
    child.on("error", (error) => reject(new UserError("Could not start Git for metadata fetch", error.message)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new UserError(`Git metadata fetch failed (exit ${code})`, errorText.trim()));
    });
  });
}

async function directorySize(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) bytes += await directorySize(fullPath);
    else if (entry.isFile()) bytes += (await stat(fullPath)).size;
  }
  return bytes;
}

async function verifySparseCheckout(root) {
  const globalText = await readFile(path.join(root, "global_metadata.yaml"), "utf8");
  const declaredMatch = /^total_sessions:\s*(\d+)\s*$/mu.exec(globalText);
  if (!declaredMatch) throw new UserError("Downloaded global_metadata.yaml has no total_sessions value");
  const declaredSessions = Number(declaredMatch[1]);
  const sessionRoot = path.join(root, "evaluation_sessions");
  const sessions = (await readdir(sessionRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  let metadataFiles = 0;
  for (const session of sessions) {
    try {
      await access(path.join(sessionRoot, session.name, "metadata.yaml"));
      metadataFiles += 1;
    } catch {
      throw new UserError(`Sparse metadata checkout is missing ${session.name}/metadata.yaml`);
    }
  }
  if (metadataFiles !== declaredSessions) {
    throw new UserError(
      `Sparse metadata checkout is incomplete: global metadata declares ${declaredSessions} sessions, ` +
      `but ${metadataFiles} session YAML files were checked out.`,
    );
  }
  return metadataFiles;
}

export async function downloadRoboArenaMetadata({ target, onProgress = undefined }) {
  const resolvedTarget = assertExternalTarget(target);
  try {
    await stat(resolvedTarget);
    throw new UserError(`Metadata target already exists; refusing to overwrite it: ${resolvedTarget}`);
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (error.code !== "ENOENT") throw error;
  }

  const parent = path.dirname(resolvedTarget);
  const temporary = path.join(parent, `.${path.basename(resolvedTarget)}.download-${process.pid}`);
  await mkdir(parent, { recursive: true });
  try {
    await stat(temporary);
    throw new UserError(`Temporary metadata target already exists: ${temporary}`);
  } catch (error) {
    if (error instanceof UserError) throw error;
    if (error.code !== "ENOENT") throw error;
  }

  const gitEnvironment = { GIT_LFS_SKIP_SMUDGE: "1" };
  try {
    onProgress?.({ stage: "fetching one Git pack without LFS media" });
    await runGit(
      ["-c", "core.protectNTFS=false", "clone", "--no-checkout", REPOSITORY_URL, temporary],
      gitEnvironment,
    );
    onProgress?.({ stage: "checking out YAML metadata only" });
    await runGit(["-C", temporary, "-c", "core.protectNTFS=false", "sparse-checkout", "init", "--no-cone"]);
    await runGit([
      "-C", temporary, "-c", "core.protectNTFS=false", "sparse-checkout", "set", "--no-cone",
      "/README.md", "/global_metadata.yaml", "/evaluation_sessions/*/metadata.yaml",
    ]);
    await runGit(["-C", temporary, "-c", "core.protectNTFS=false", "checkout", REVISION], gitEnvironment);
    const sessionMetadataFiles = await verifySparseCheckout(temporary);

    const gitDirectory = path.resolve(temporary, ".git");
    if (path.dirname(gitDirectory) !== path.resolve(temporary)) {
      throw new UserError("Refusing to remove unexpected Git metadata path");
    }
    await rm(gitDirectory, { recursive: true, force: true });
    await writeFile(
      path.join(temporary, "metadata-download.json"),
      `${JSON.stringify({
        repository: REPOSITORY_ID,
        revision: REVISION,
        downloaded_at: new Date().toISOString(),
        session_metadata_files: sessionMetadataFiles,
        media_downloaded: false,
      }, null, 2)}\n`,
      { flag: "wx" },
    );
    const bytes = await directorySize(temporary);
    await rename(temporary, resolvedTarget);
    return {
      target: resolvedTarget,
      sessionMetadataFiles,
      files: sessionMetadataFiles + 3,
      bytes,
      mediaDownloaded: false,
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

