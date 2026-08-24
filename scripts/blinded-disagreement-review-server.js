#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

const studyDir = path.resolve(process.argv[2] ?? "");
const pass = process.argv[3];
const port = Number(process.argv[4] ?? (pass === "progress" ? 4320 : 4319));
if (!process.argv[2] || !["strict", "progress"].includes(pass) || !Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error("Usage: node scripts/blinded-disagreement-review-server.js <study-dir> <strict|progress> [port]");
  process.exit(2);
}

const protocol = JSON.parse(await readFile(path.join(studyDir, "study-protocol.json"), "utf8"));
const passProtocol = protocol.passes[pass];
const taskFile = JSON.parse(await readFile(path.join(studyDir, passProtocol.tasks_file), "utf8"));
const items = taskFile.items;
const resultPath = path.join(studyDir, passProtocol.results_file);
const allowedReasons = pass === "strict"
  ? new Map([["COMPLETE", true], ["NO_PROGRESS", false], ["PARTIAL", false], ["WRONG_ACTION", false], ["NOT_VISIBLE", false], ["ABORTED", false]])
  : new Map([["COMPLETE", true], ["SUBSTANTIAL_PROGRESS", true], ["LIMITED_PROGRESS", false], ["NO_PROGRESS", false], ["WRONG_ACTION", false], ["NOT_VISIBLE", false], ["ABORTED", false]]);

if (pass === "progress") {
  let strictCompleted = 0;
  try {
    strictCompleted = (await readFile(path.join(studyDir, protocol.passes.strict.results_file), "utf8")).split(/\r?\n/u).filter(Boolean).length;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (strictCompleted !== protocol.selected_items) {
    throw new Error(`Progress-aware pass is sealed until all ${protocol.selected_items} strict reviews are complete`);
  }
}

async function readResults() {
  try {
    return new Map((await readFile(resultPath, "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => {
      const value = JSON.parse(line);
      return [value.study_item_id, value];
    }));
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
}

async function writeResults(results) {
  const ordered = items.map((item) => results.get(item.study_item_id)).filter(Boolean);
  const temporary = `${resultPath}.tmp-${process.pid}`;
  await writeFile(temporary, ordered.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
  await rename(temporary, resultPath);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
}

function buttons() {
  if (pass === "strict") return `
<button class="success" data-reason="COMPLETE">1 — COMPLETE / SUCCESS</button>
<button class="failure" data-reason="NO_PROGRESS">2 — NO PROGRESS</button>
<button class="failure" data-reason="PARTIAL">3 — PARTIAL</button>
<button class="failure" data-reason="WRONG_ACTION">4 — WRONG ACTION</button>
<button class="failure" data-reason="NOT_VISIBLE">5 — NOT VISIBLE</button>
<button class="failure" data-reason="ABORTED">6 — ABORTED</button>`;
  return `
<button class="success" data-reason="COMPLETE">1 — COMPLETE / SUCCESS</button>
<button class="success" data-reason="SUBSTANTIAL_PROGRESS">2 — SUBSTANTIAL / SUCCESS</button>
<button class="failure" data-reason="LIMITED_PROGRESS">3 — LIMITED PROGRESS</button>
<button class="failure" data-reason="NO_PROGRESS">4 — NO PROGRESS</button>
<button class="failure" data-reason="WRONG_ACTION">5 — WRONG ACTION</button>
<button class="failure" data-reason="NOT_VISIBLE">6 — NOT VISIBLE</button>
<button class="failure" data-reason="ABORTED">7 — ABORTED</button>`;
}

function page(index, reviewed) {
  const item = items[index];
  if (!item) return "<!doctype html><title>Review complete</title><h1>Review complete</h1>";
  const existing = reviewed.get(item.study_item_id);
  const nextUnreviewed = items.findIndex((candidate, candidateIndex) => candidateIndex > index && !reviewed.has(candidate.study_item_id));
  const nextIndex = nextUnreviewed < 0 ? Math.min(items.length, index + 1) : nextUnreviewed;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${pass} ${index + 1}/${items.length}</title>
<style>body{font-family:system-ui,sans-serif;margin:14px;background:#111;color:#eee}h1{font-size:20px;margin:0 0 6px}.rubric{white-space:pre-line;background:#203040;border-left:5px solid #6af;padding:10px;margin:8px 0;font-size:14px}.instruction{font-size:24px;font-weight:700;padding:10px;background:#242424;border-left:5px solid #6af;margin-bottom:10px}.meta{color:#aaa}.layout{display:grid;grid-template-columns:520px 1fr;gap:12px}video{width:520px;max-height:335px;background:#000}.frames{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}.frame{position:relative;background:#000;min-height:90px}.frame canvas{width:100%;display:block}.frame span{position:absolute;left:3px;bottom:2px;background:#000b;padding:1px 3px;font-size:11px}.controls{margin-top:10px;display:flex;gap:6px;flex-wrap:wrap}.controls button{font-size:14px;padding:9px 12px}.success{background:#176c36;color:#fff}.failure{background:#7d2525;color:#fff}.nav{margin-left:auto}.existing{color:#ffda6a}textarea{width:100%;height:48px;margin-top:8px;background:#222;color:#fff;border:1px solid #555;padding:7px;box-sizing:border-box}select{background:#222;color:#fff;padding:8px}.status{margin-top:6px;color:#9bd}</style></head><body>
<h1>Blinded ${pass === "strict" ? "strict" : "progress-aware"} rereview — ${index + 1}/${items.length}</h1>
<div class="meta">Reviewed ${reviewed.size}/${items.length} · study item ${escapeHtml(item.study_item_id)} ${existing ? '<span class="existing">· already reviewed</span>' : ""}</div>
<div class="rubric">${escapeHtml(passProtocol.rubric)}</div><div class="instruction">${escapeHtml(item.instruction)}</div>
<div class="layout"><video id="video" controls muted preload="auto" src="/video/${encodeURIComponent(item.study_item_id)}"></video><div id="frames" class="frames"></div></div>
<textarea id="note" placeholder="Specific visible evidence (recommended)"></textarea><div class="controls"><select id="confidence"><option value="0.8">80% confidence</option><option value="0.9">90% confidence</option><option value="0.7">70% confidence</option><option value="0.6">60% confidence</option></select>${buttons()}<span class="nav"><button onclick="location.href='/?index=${Math.max(0, index - 1)}'">Previous</button><button onclick="location.href='/?index=${nextIndex}'">Skip/next</button></span></div><div id="status" class="status">Loading eight uniformly sampled frames…</div>
<script>const video=document.querySelector('#video'),frames=document.querySelector('#frames'),status=document.querySelector('#status');const seek=time=>new Promise(resolve=>{const done=()=>{video.removeEventListener('seeked',done);resolve()};video.addEventListener('seeked',done);video.currentTime=time});video.addEventListener('loadedmetadata',async()=>{for(let i=0;i<8;i++){const t=Math.min(Math.max(0,video.duration-0.05),video.duration*i/7);await seek(t);const wrap=document.createElement('div');wrap.className='frame';const c=document.createElement('canvas');c.width=320;c.height=Math.round(320*video.videoHeight/video.videoWidth);c.getContext('2d').drawImage(video,0,0,c.width,c.height);const label=document.createElement('span');label.textContent=t.toFixed(1)+'s';wrap.append(c,label);frames.append(wrap)}video.currentTime=0;status.textContent='Frames ready. Review sequence left-to-right, top-to-bottom.'});async function submit(button){document.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='Saving…';const response=await fetch('/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({study_item_id:${JSON.stringify(item.study_item_id)},reason_code:button.dataset.reason,confidence:Number(document.querySelector('#confidence').value),evidence:document.querySelector('#note').value})});if(!response.ok){status.textContent='Save failed: '+await response.text();document.querySelectorAll('button').forEach(b=>b.disabled=false);return}location.href='/?index=${nextIndex}'}document.querySelectorAll('[data-reason]').forEach(button=>button.addEventListener('click',()=>submit(button)));document.addEventListener('keydown',event=>{if(event.target.tagName==='TEXTAREA'||event.target.tagName==='SELECT')return;const button=[...document.querySelectorAll('[data-reason]')].find(candidate=>candidate.textContent.trim().startsWith(event.key+' '));if(button)submit(button)});</script></body></html>`;
}

function json(response, statusCode, value) { response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(value)); }

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (request.method === "GET" && url.pathname === "/") {
      const reviewed = await readResults();
      const index = Math.max(0, Math.min(items.length, Number(url.searchParams.get("index") ?? 0) || 0));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); response.end(page(index, reviewed)); return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/video/")) {
      const studyItemId = decodeURIComponent(url.pathname.slice("/video/".length));
      const item = items.find((candidate) => candidate.study_item_id === studyItemId);
      if (!item) return json(response, 404, { error: "unknown item" });
      const pilotDir = path.dirname(studyDir);
      const videoPath = path.resolve(studyDir, ...item.media_relative_path.split("/"));
      const relative = path.relative(pilotDir, videoPath);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return json(response, 400, { error: "invalid media path" });
      const info = await stat(videoPath); const range = request.headers.range;
      if (range) { const match = /^bytes=(\d+)-(\d*)$/u.exec(range); if (!match) return json(response, 416, { error: "invalid range" }); const start=Number(match[1]); const end=match[2]?Math.min(Number(match[2]),info.size-1):info.size-1; response.writeHead(206,{"content-type":"video/mp4","accept-ranges":"bytes","content-range":`bytes ${start}-${end}/${info.size}`,"content-length":end-start+1}); createReadStream(videoPath,{start,end}).pipe(response); }
      else { response.writeHead(200,{"content-type":"video/mp4","content-length":info.size,"accept-ranges":"bytes"}); createReadStream(videoPath).pipe(response); } return;
    }
    if (request.method === "POST" && url.pathname === "/review") {
      let body=""; for await (const chunk of request) { body+=chunk; if(body.length>10000) throw new Error("review body too large"); }
      const value=JSON.parse(body); const item=items.find((candidate)=>candidate.study_item_id===value.study_item_id); const success=allowedReasons.get(value.reason_code);
      if(!item||typeof success!=="boolean"||!Number.isFinite(value.confidence)||value.confidence<0.5||value.confidence>1) return json(response,400,{error:"invalid review"});
      const results=await readResults(); const partial=value.reason_code==="COMPLETE"?1:["SUBSTANTIAL_PROGRESS","LIMITED_PROGRESS","PARTIAL"].includes(value.reason_code)?0.5:0;
      results.set(item.study_item_id,{result_version:1,study_item_id:item.study_item_id,reviewer:"codex-local-blinded-rereview",reviewer_version:"codex-local-blinded-rereview-v1",pass,rubric_sha256:passProtocol.rubric_sha256,verdict:success?"SUCCESS":"FAILURE",success,confidence:value.confidence,automatic_score:success?value.confidence:1-value.confidence,partial_success:partial,reason_code:value.reason_code,evidence:String(value.evidence??"").trim().slice(0,600)||`Visible sequence classified as ${value.reason_code} under the frozen ${pass} rubric.`,reviewed_at:new Date().toISOString(),review_method:"local-browser-eight-frame-plus-video"});
      await writeResults(results); return json(response,200,{saved:true,completed:results.size,total:items.length});
    }
    json(response,404,{error:"not found"});
  } catch (error) { json(response,500,{error:error.message}); }
});

server.listen(port,"127.0.0.1",()=>{ console.log(`Blinded ${pass} review: http://127.0.0.1:${port}/?index=0`); console.log(`Results: ${resultPath}`); });

