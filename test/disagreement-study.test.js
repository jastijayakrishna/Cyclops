import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeDisagreementStudy, createDisagreementStudy } from "../src/disagreement-study.js";

async function fixture(root) {
  const pilot = path.join(root, "pilot");
  await mkdir(path.join(pilot, "videos"), { recursive: true });
  const policies = ["policy-a", "policy-b"];
  const analysisItems = Array.from({ length: 8 }, (_, index) => ({ item_id: `item-${index}`, comparison_id: `pair-${Math.floor(index/2)}`, policy: policies[index%2], task: `task ${index}`, site: "hidden", human_success: index < 3, human_score: index < 3 ? 1 : 0 }));
  const originals = analysisItems.map((item, index) => ({ item_id:item.item_id,success:index>=3,reason_code:index>=3?"COMPLETE":"NO_PROGRESS" }));
  const tasks = analysisItems.map((item) => ({ item_id:item.item_id,instruction:item.task }));
  const videos = analysisItems.map((item,index) => ({ item_id:item.item_id,local_path:`videos/${item.item_id}.mp4`,sha256:String(index).padStart(64,"0") }));
  for (const item of analysisItems) await writeFile(path.join(pilot,"videos",`${item.item_id}.mp4`),"video");
  await Promise.all([
    writeFile(path.join(pilot,"analysis-key.json"),JSON.stringify({items:analysisItems})),
    writeFile(path.join(pilot,"judge-tasks.json"),JSON.stringify({items:tasks})),
    writeFile(path.join(pilot,"video-index.json"),JSON.stringify({videos})),
    writeFile(path.join(pilot,"manual-judge-results.jsonl"),originals.map(JSON.stringify).join("\n")+"\n"),
    writeFile(path.join(pilot,"judge-results.jsonl"),""),
    writeFile(path.join(pilot,"protocol.json"),JSON.stringify({baseline:"policy-a",candidate:"policy-b"})),
  ]);
  return { pilot, analysisItems, originals };
}

test("creates independently shuffled blinded disagreement passes", async (context) => {
  const root=await mkdtemp(path.join(tmpdir(),"disagreement-study-")); context.after(()=>rm(root,{recursive:true,force:true}));
  const {pilot}=await fixture(root); const study=path.join(pilot,"study");
  const result=await createDisagreementStudy({pilotDir:pilot,studyDir:study,seed:91});
  assert.equal(result.selectedItems,8);
  const strict=await readFile(path.join(study,"strict-tasks.json"),"utf8"); const progress=await readFile(path.join(study,"progress-tasks.json"),"utf8");
  assert.doesNotMatch(strict,/policy-a|policy-b|human_success|original_success|reason_code/u);
  assert.doesNotMatch(progress,/policy-a|policy-b|human_success|original_success|reason_code/u);
  assert.notEqual(JSON.parse(strict).items.map((item)=>item.media_sha256).join("|"),JSON.parse(progress).items.map((item)=>item.media_sha256).join("|"));
});

test("analyzes only after both complete passes and reports reproduction", async (context) => {
  const root=await mkdtemp(path.join(tmpdir(),"disagreement-analysis-")); context.after(()=>rm(root,{recursive:true,force:true}));
  const {pilot}=await fixture(root); const study=path.join(pilot,"study"); await createDisagreementStudy({pilotDir:pilot,studyDir:study,seed:23});
  const key=JSON.parse(await readFile(path.join(study,"private-analysis-key.json"),"utf8"));
  const strict=key.items.map((item,index)=>({study_item_id:item.strict_study_item_id,success:index!==0?item.original_success:!item.original_success,reason_code:index!==0?item.original_reason_code:"COMPLETE"}));
  const progress=key.items.map((item)=>({study_item_id:item.progress_study_item_id,success:true,reason_code:"SUBSTANTIAL_PROGRESS"}));
  await writeFile(path.join(study,"strict-results.jsonl"),strict.map(JSON.stringify).join("\n")+"\n");
  await assert.rejects(analyzeDisagreementStudy({studyDir:study}),/Cannot read progress-aware rereview results/u);
  await writeFile(path.join(study,"progress-results.jsonl"),progress.map(JSON.stringify).join("\n")+"\n");
  const report=await analyzeDisagreementStudy({studyDir:study});
  assert.equal(report.self_reproduction.agreements,7);
  assert.equal(report.self_reproduction.rate,0.875);
  assert.equal(report.self_reproduction.interpretation,"INTERMEDIATE");
  assert.equal(report.rubric_sensitivity.selected_items_progress_successes,8);
});

