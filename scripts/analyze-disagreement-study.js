#!/usr/bin/env node
import { analyzeDisagreementStudy } from "../src/disagreement-study.js";

const studyDir = process.argv[2];
if (!studyDir) {
  console.error("Usage: node scripts/analyze-disagreement-study.js <study-dir>");
  process.exit(2);
}

const result = await analyzeDisagreementStudy({ studyDir });
console.log(JSON.stringify({
  self_reproduction: result.self_reproduction,
  selected_policy_ranking: result.policy_ranking.selected_47_only,
  full_pilot_carry_forward: result.policy_ranking.full_pilot_carry_forward,
  machine_judges: result.machine_judges,
}, null, 2));

