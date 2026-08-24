import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { downloadRoboArenaMetadata } from "../src/download.js";
import { UserError } from "../src/errors.js";

test("metadata downloader rejects a target inside the Git project before network access", async () => {
  await assert.rejects(
    downloadRoboArenaMetadata({ target: path.join(process.cwd(), "forbidden-dataset") }),
    (error) => error instanceof UserError && /outside this Git repository/u.test(error.message),
  );
});
