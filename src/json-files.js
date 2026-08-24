import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { UserError } from "./errors.js";

export async function readJson(filePath, label = "JSON file") {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new UserError(`Cannot read ${label}: ${filePath}`, error.message);
  }
}

export async function writeJsonAtomic(filePath, value) {
  const resolved = path.resolve(filePath);
  await mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, resolved);
}

