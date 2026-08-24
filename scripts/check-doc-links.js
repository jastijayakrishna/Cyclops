#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set([".git", ".build", ".qa", "node_modules"]);
const markdown = [];

function collect(directory) {
  for (const name of readdirSync(directory)) {
    if (ignored.has(name)) continue;
    const target = path.join(directory, name);
    const info = statSync(target);
    if (info.isDirectory()) collect(target);
    else if (name.endsWith(".md")) markdown.push(target);
  }
}

collect(root);
const broken = [];
const pattern = /\[[^\]]*\]\(([^)]+)\)/gu;
for (const source of markdown) {
  const text = readFileSync(source, "utf8");
  for (const match of text.matchAll(pattern)) {
    let href = match[1].trim().replace(/^<|>$/gu, "");
    if (/^(?:https?:|mailto:|#)/iu.test(href)) continue;
    href = decodeURIComponent(href.split("#", 1)[0]);
    if (!href) continue;
    const target = path.resolve(path.dirname(source), href);
    if (!existsSync(target)) {
      broken.push(`${path.relative(root, source)} -> ${href}`);
    }
  }
}

if (broken.length) {
  console.error("Documentation link check failed:");
  for (const item of broken) console.error(`- ${item}`);
  process.exit(1);
}

console.log(`Documentation links passed: ${markdown.length} Markdown files checked.`);
