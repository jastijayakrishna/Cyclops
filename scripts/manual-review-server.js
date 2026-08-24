#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

const pilotDir = path.resolve(process.argv[2] ?? "");
const port = Number(process.argv[3] ?? 4317);
if (!process.argv[2] || !Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("Usage: node scripts/manual-review-server.js <pilot-dir> [port]");
  process.exit(2);
}

const rubric = `Review one wrist-camera robot video against only its task instruction.
SUCCESS means the requested end state is visibly achieved. FAILURE means it is not achieved,
the wrong action occurs, progress is only partial, the outcome is not visible, or the run aborts.
Do not use policy identity, site identity, or the hidden human label.`;
const rubricHash = createHash("sha256").update(rubric).digest("hex");
const resultPath = path.join(pilotDir, "manual-judge-results.jsonl");
const tasks = JSON.parse(await readFile(path.join(pilotDir, "judge-tasks.json"), "utf8")).items;
const videos = JSON.parse(await readFile(path.join(pilotDir, "video-index.json"), "utf8")).videos;
const taskMap = new Map(tasks.map((item) => [item.item_id, item]));
const items = videos.map((video) => ({ ...video, instruction: taskMap.get(video.item_id)?.instruction }));
if (items.length !== tasks.length || items.some((item) => !item.instruction)) {
  throw new Error("Manual review inputs are incomplete or mismatched");
}

async function readResults() {
  try {
    const text = await readFile(resultPath, "utf8");
    return new Map(text.split(/\r?\n/u).filter(Boolean).map((line) => {
      const value = JSON.parse(line);
      return [value.item_id, value];
    }));
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
}

async function writeResults(results) {
  const ordered = items.map((item) => results.get(item.item_id)).filter(Boolean);
  const temporary = `${resultPath}.tmp-${process.pid}`;
  await writeFile(temporary, ordered.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
  await rename(temporary, resultPath);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function page(index, reviewed) {
  const item = items[index];
  if (!item) return "<!doctype html><title>Manual review complete</title><h1>Manual review complete</h1>";
  const existing = reviewed.get(item.item_id);
  const nextUnreviewed = items.findIndex((candidate, candidateIndex) =>
    candidateIndex > index && !reviewed.has(candidate.item_id));
  const nextIndex = nextUnreviewed < 0 ? Math.min(items.length, index + 1) : nextUnreviewed;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Review ${index + 1}/${items.length}</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;background:#111;color:#eee}h1{font-size:20px;margin:0 0 8px}
.instruction{font-size:24px;font-weight:700;padding:12px;background:#242424;border-left:5px solid #6af;margin-bottom:12px}
.meta{color:#aaa;margin-bottom:10px}.layout{display:grid;grid-template-columns:520px 1fr;gap:14px;align-items:start}
video{width:520px;max-height:340px;background:#000}.frames{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}
.frame{position:relative;background:#000;min-height:100px}.frame canvas{width:100%;display:block}.frame span{position:absolute;left:4px;bottom:3px;background:#000b;padding:1px 4px;font-size:11px}
.controls{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}.controls button{font-size:15px;padding:10px 14px;cursor:pointer}
.success{background:#176c36;color:#fff}.failure{background:#7d2525;color:#fff}.nav{margin-left:auto}.existing{color:#ffda6a}
textarea{width:100%;height:54px;margin-top:10px;background:#222;color:#fff;border:1px solid #555;padding:8px;box-sizing:border-box}
select{background:#222;color:#fff;padding:9px}.status{margin-top:8px;color:#9bd}
</style></head><body>
<h1>Blinded local manual review — item ${index + 1} of ${items.length}</h1>
<div class="meta">Reviewed ${reviewed.size}/${items.length} · item ${escapeHtml(item.item_id)} ${existing ? '<span class="existing">· already reviewed</span>' : ""}</div>
<div class="instruction">${escapeHtml(item.instruction)}</div>
<div class="layout"><video id="video" controls muted preload="auto" src="/video/${encodeURIComponent(item.item_id)}"></video><div id="frames" class="frames"></div></div>
<textarea id="note" placeholder="Optional specific visual evidence"></textarea>
<div class="controls"><select id="confidence"><option value="0.8">80% confidence</option><option value="0.9">90% confidence</option><option value="0.7">70% confidence</option><option value="0.6">60% confidence</option></select>
<button class="success" data-success="true" data-reason="COMPLETE">1 — SUCCESS</button>
<button class="failure" data-success="false" data-reason="NO_PROGRESS">2 — NO PROGRESS</button>
<button class="failure" data-success="false" data-reason="PARTIAL">3 — PARTIAL</button>
<button class="failure" data-success="false" data-reason="WRONG_ACTION">4 — WRONG ACTION</button>
<button class="failure" data-success="false" data-reason="NOT_VISIBLE">5 — NOT VISIBLE</button>
<button class="failure" data-success="false" data-reason="ABORTED">6 — ABORTED</button>
<span class="nav"><button onclick="location.href='/?index=${Math.max(0, index - 1)}'">Previous</button><button onclick="location.href='/?index=${nextIndex}'">Skip/next</button></span></div>
<div id="status" class="status">Loading eight uniformly sampled frames…</div>
<script>
const video=document.querySelector('#video'), frames=document.querySelector('#frames'), status=document.querySelector('#status');
const seek=time=>new Promise(resolve=>{const done=()=>{video.removeEventListener('seeked',done);resolve()};video.addEventListener('seeked',done);video.currentTime=time});
video.addEventListener('loadedmetadata',async()=>{for(let i=0;i<8;i++){const t=Math.min(Math.max(0,video.duration-0.05),video.duration*i/7);await seek(t);const wrap=document.createElement('div');wrap.className='frame';const c=document.createElement('canvas');c.width=320;c.height=Math.round(320*video.videoHeight/video.videoWidth);c.getContext('2d').drawImage(video,0,0,c.width,c.height);const label=document.createElement('span');label.textContent=t.toFixed(1)+'s';wrap.append(c,label);frames.append(wrap)}video.currentTime=0;status.textContent='Frames ready. Review the temporal sequence left-to-right, top-to-bottom.'});
async function submit(button){document.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Saving…';const response=await fetch('/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({item_id:${JSON.stringify(item.item_id)},success:button.dataset.success==='true',reason_code:button.dataset.reason,confidence:Number(document.querySelector('#confidence').value),evidence:document.querySelector('#note').value})});if(!response.ok){status.textContent='Save failed: '+await response.text();document.querySelectorAll('button').forEach(b=>b.disabled=false);return}location.href='/?index=${nextIndex}'}
document.querySelectorAll('[data-reason]').forEach(button=>button.addEventListener('click',()=>submit(button)));
document.addEventListener('keydown',event=>{if(event.target.tagName==='TEXTAREA'||event.target.tagName==='SELECT')return;const button=[...document.querySelectorAll('[data-reason]')].find(candidate=>candidate.textContent.trim().startsWith(event.key+' '));if(button)submit(button)});
</script></body></html>`;
}

function json(response, statusCode, value) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/") {
      const reviewed = await readResults();
      const index = Math.max(0, Math.min(items.length, Number(url.searchParams.get("index") ?? 0) || 0));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(page(index, reviewed));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/video/")) {
      const itemId = decodeURIComponent(url.pathname.slice("/video/".length));
      const item = items.find((candidate) => candidate.item_id === itemId);
      if (!item) return json(response, 404, { error: "unknown item" });
      const videoPath = path.join(pilotDir, ...item.local_path.split("/"));
      const info = await stat(videoPath);
      const range = request.headers.range;
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/u.exec(range);
        if (!match) return json(response, 416, { error: "invalid range" });
        const start = Number(match[1]);
        const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
        response.writeHead(206, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${info.size}`, "content-length": end - start + 1 });
        createReadStream(videoPath, { start, end }).pipe(response);
      } else {
        response.writeHead(200, { "content-type": "video/mp4", "content-length": info.size, "accept-ranges": "bytes" });
        createReadStream(videoPath).pipe(response);
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/review") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 10000) throw new Error("review body too large");
      }
      const value = JSON.parse(body);
      const item = items.find((candidate) => candidate.item_id === value.item_id);
      const reasons = new Set(["COMPLETE", "NO_PROGRESS", "PARTIAL", "WRONG_ACTION", "NOT_VISIBLE", "ABORTED"]);
      if (!item || typeof value.success !== "boolean" || !reasons.has(value.reason_code) ||
          !Number.isFinite(value.confidence) || value.confidence < 0.5 || value.confidence > 1) {
        return json(response, 400, { error: "invalid review" });
      }
      if (value.success !== (value.reason_code === "COMPLETE")) return json(response, 400, { error: "verdict/reason mismatch" });
      const results = await readResults();
      const defaults = {
        COMPLETE: "The requested end state is visible in the locally sampled sequence.",
        NO_PROGRESS: "The locally sampled sequence shows no meaningful progress toward the requested end state.",
        PARTIAL: "The locally sampled sequence shows progress, but the requested end state is not completed.",
        WRONG_ACTION: "The locally sampled sequence shows an action or end state different from the instruction.",
        NOT_VISIBLE: "The requested end state cannot be verified from the local wrist-camera sequence.",
        ABORTED: "The locally sampled sequence ends before the requested task is completed.",
      };
      const success = value.success;
      results.set(item.item_id, {
        result_version: 1,
        item_id: item.item_id,
        model: "codex-local-manual-review",
        model_version: "codex-local-manual-review-v1",
        prompt_version: "manual-local-review-v1",
        prompt_sha256: rubricHash,
        verdict: success ? "SUCCESS" : "FAILURE",
        success,
        confidence: value.confidence,
        automatic_score: success ? value.confidence : 1 - value.confidence,
        partial_success: value.reason_code === "COMPLETE" ? 1 : value.reason_code === "PARTIAL" ? 0.5 : 0,
        reason_code: value.reason_code,
        evidence: String(value.evidence ?? "").trim().slice(0, 600) || defaults[value.reason_code],
        usage: { prompt_tokens: 0, output_tokens: 0, total_tokens: 0 },
        reviewed_at: new Date().toISOString(),
        review_method: "local-browser-eight-frame-plus-video",
      });
      await writeResults(results);
      return json(response, 200, { saved: true, completed: results.size, total: items.length });
    }
    json(response, 404, { error: "not found" });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Manual review server: http://127.0.0.1:${port}/?index=0`);
  console.log(`Results: ${resultPath}`);
});
