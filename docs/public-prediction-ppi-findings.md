# Public RoboRewardBench predictions: policy distortion and PPI findings

**Status:** completed exploratory secondary analysis, 2026-08-13.  
**Compute:** no Ollama, no model inference, no API calls, no video download, and no new manual labels.

## Reproduction

Public JSON is fetched to an external directory:

```powershell
node .\scripts\fetch-roboreward-bench.js `
  --target C:\path\outside-repo\roboreward-bench-v0.0.1

node .\scripts\public-prediction-ppi-study.js `
  --population C:\path\normalized-07-17-2026.jsonl `
  --benchmark-root C:\path\outside-repo\roboreward-bench-v0.0.1 `
  --output C:\path\outside-repo\roboreward-bench-v0.0.1\policy-ppi-results.json `
  --repetitions 1000
```

The fetcher records source URLs, byte counts, and SHA-256 hashes in the external manifest. It downloads 25 prediction files and one instance file, but no videos. The analysis uses seed 20260813, a minimum of fifty matched sessions per pair, and 10%, 20%, 30%, and 50% label fractions.

## Coverage and validity checks

The public 1,000 camera-view instances join to:

- 676 unique policy episodes;
- 158 unique matched sessions;
- 259 episodes with multiple camera views;
- eight policies and twelve sites; and
- twenty policy pairs with at least fifty sessions for 24 models.

For the two principal examples, all 1,000 records had valid IDs, references, predictions, and population joins; no episode had conflicting reference scores across cameras. Numeric HELM suffixes were not used as cross-run keys because they differ across released runs. The stable video stem—session UUID, policy slot, and view—was exact.

Twenty-four models retained all twenty eligible pairs. Llama 4 Scout produced 236 responses without a parseable `ANSWER: 1..5`, leaving 561 episodes and four eligible pairs. Three other models lost one to nine camera responses but retained all twenty pairs. Nothing was imputed.

## Policy-level distortion

All 24 models with full twenty-pair coverage changed at least one paired 95% policy decision relative to the human-verified reference. Selected results are:

| Released model | Episode MAE | Mean absolute policy-effect shift | Sign reversals | Decision changes | Median fixed-PPI variance ratio |
|---|---:|---:|---:|---:|---:|
| RoboReward Qwen3-VL 8B | 0.746 | 0.175 | 0 | 5 | 0.74 |
| GPT-5.5 | 0.751 | 0.152 | 2 | 2 | 0.93 |
| RoboReward Qwen3-VL 4B | 0.784 | 0.222 | 1 | 4 | 0.80 |
| GPT-5 mini | 0.796 | 0.132 | 1 | 2 | 1.03 |
| Gemini 2.5 Pro | 0.873 | 0.203 | 2 | 3 | 1.39 |
| Gemini 2.5 Flash | 1.121 | 0.228 | 4 | 3 | 1.70 |
| Gemini 2.5 Flash-Lite | 1.128 | 0.368 | 4 | 6 | 1.61 |
| Llama 4 Maverick | 1.462 | 0.250 | 4 | 3 | 1.68 |

Effects are in points on the benchmark's 1-5 scale. A decision change means that the paired 95% interval supports the candidate, supports the baseline, or remains insufficient differently under VLM versus reference scores. It does not mean the human reference is infallible.

The result establishes reference-relative policy distortion on this finite benchmark. It does not establish a population prevalence for unseen robot tasks.

## Human-reference reconstruction

The target below is the full-reference finite-set policy effect. Each entry averages twenty policy pairs and 1,000 repeated session-level label samples.

### RoboReward Qwen3-VL 8B

| Revealed labels | Method | Coverage | Mean absolute error | Mean interval width | Ranking agreement |
|---:|---|---:|---:|---:|---:|
| 10% | human only | 94.7% | 0.434 | 2.603 | 74.7% |
| 10% | fixed PPI | 94.7% | 0.369 | 2.234 | 80.1% |
| 20% | human only | 94.9% | 0.296 | 1.571 | 80.7% |
| 20% | fixed PPI | 94.9% | 0.250 | 1.349 | 85.3% |
| 30% | human only | 94.6% | 0.224 | 1.157 | 85.4% |
| 30% | fixed PPI | 94.9% | 0.191 | 0.987 | 89.0% |
| 50% | human only | 94.9% | 0.146 | 0.737 | 91.2% |
| 50% | fixed PPI | 95.2% | 0.124 | 0.630 | 93.5% |

Fixed PPI retains nominal coverage while reducing mean interval width and absolute error by approximately 14-15% at every tested budget. Its median residual-variance ratio is 0.736, corresponding to about 26% lower label variance asymptotically on these pairs. Because this model was identified after inspecting all released results, this is exploratory evidence of possible label savings, not a confirmatory estimate.

### Gemini 2.5 Flash-Lite

| Revealed labels | Method | Coverage | Mean absolute error | Mean interval width | Ranking agreement |
|---:|---|---:|---:|---:|---:|
| 10% | human only | 94.7% | 0.435 | 2.583 | 74.7% |
| 10% | fixed PPI | 95.3% | 0.545 | 3.254 | 75.2% |
| 20% | human only | 95.1% | 0.295 | 1.572 | 80.9% |
| 20% | fixed PPI | 95.1% | 0.365 | 1.966 | 79.6% |
| 30% | human only | 94.8% | 0.224 | 1.158 | 85.5% |
| 30% | fixed PPI | 94.5% | 0.278 | 1.445 | 83.4% |
| 50% | human only | 94.8% | 0.146 | 0.737 | 91.3% |
| 50% | fixed PPI | 94.6% | 0.184 | 0.920 | 89.1% |

Fixed PPI preserves coverage but increases interval width and error by roughly 25%. This judge does not save labels under the fixed correction.

Only five of the 25 released runs had a median fixed-PPI variance ratio below one. Label savings are therefore conditional on the judge, not a general property of automatic evaluation.

## Adaptive correction

The clipped adaptive regression coefficient reduces dependence on Flash-Lite and improves its point error slightly. After deducting a fitted-coefficient degree of freedom, its empirical coverage is 93.4-94.2% for Flash-Lite and 94.2-94.7% for RoboReward 8B across the tested budgets. That is close but not consistently nominal. Adaptive PPI is therefore secondary and cannot support the headline label-saving claim without independent selection, cross-fitting, or a more conservative interval.

## Claims boundary

- RoboRewardBench uses a full-video 1-5 progress prompt. These predictions do not execute the frozen eight-frame binary-success Gemini pilot.
- The references are human-verified but not independent blinded multi-rater gold. The analysis measures disagreement and residual distortion relative to them.
- The reconstruction target is the finite benchmark set. Generalization to future tasks, sites, policies, or robots remains unverified.
- All model selection and comparisons are exploratory because the released test labels and predictions were inspected during method development.
- A decision change is not automatically an operationally important error; a practical-effect threshold should be frozen for confirmatory work.

## Decision

The machine-judge part of the proposal is now empirically supported: released VLM scores can materially change policy-level conclusions. The universal label-saving hypothesis is rejected. A narrower hypothesis remains plausible: a prespecified high-quality reward model can reduce human-reference reconstruction error through fixed PPI, while a weak model must be rejected or downweighted.
