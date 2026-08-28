# Robot Evaluation Decision Engine

[![research-software-checks](https://github.com/jastijayakrishna/Cyclops/actions/workflows/ci.yml/badge.svg)](https://github.com/jastijayakrishna/Cyclops/actions/workflows/ci.yml)

**Decision-safe evaluation of robot policies when human and vision-language judgments are imperfect.**

`roboeval` answers one bounded question: given a baseline robot policy and a candidate policy, is the candidate better, practically equivalent, or still unresolved—and what evidence should be collected next?

The project studies a failure mode that episode-level evaluator accuracy can hide: small, structured judgment errors may reverse a policy-level conclusion. It combines matched RoboArena comparisons, deterministic uncertainty estimates, evaluator auditing, prediction-powered inference (PPI), and a fail-safe certificate that returns to human-only inference when automated evidence is unreliable.

**Research status:** validation-stage software with completed exploratory studies and an executable conservative baseline. Current results establish feasibility and failure modes; they do not establish external generalization or physical-robot safety.

## Research question

> Can a vision-language evaluator reduce the human review needed for simultaneous robot-policy decisions while preserving error control—and automatically abstain when the evaluator is weak, biased, or shifted?

This is deliberately a policy-decision question, not another episode-scoring benchmark. The unit of analysis is a matched robot-evaluation session; repeated camera views are aggregated within a policy episode before policies are compared.

## Evidence at a glance

The repository contains three completed exploratory analyses. Their shared conclusion is that automated evaluation is useful only conditionally: the metric and evaluator must be tested against the downstream policy decision.

| Finding | Evidence | Interpretation |
|---|---:|---|
| Human metric choice changed **7 of 28** policy decisions | 3,879 matched sessions; mean absolute shift in `P(candidate better)` of **13.0 percentage points** (95% interval: 6.4–19.6) | The definition of success can matter as much as the evaluator |
| Every released model with complete coverage changed at least one descriptive policy decision | **24 of 24** complete model runs; 20 eligible policy pairs over 158 matched sessions | Competitive episode scores do not guarantee policy-decision fidelity |
| Fixed PPI was not universally label-efficient | Only **5 of 25** released runs had a median residual-variance ratio below one | Automated judgments must be validated before use in inference |
| The strongest released run reduced interval width by about **14–15%** | Post-hoc RoboReward Qwen3-VL 8B example with approximately 95% repeated-sampling coverage | Useful automated evidence can reduce review, but this is exploratory |
| A weaker evaluator increased interval width and error by about **25%** | Gemini 2.5 Flash-Lite example with approximately 95% coverage | A valid correction can still cost more labels than human-only inference |

Proof and claim boundaries:

- [Machine-readable exploratory evidence index](results/exploratory-summary.json)
- [Human metric agreement findings](docs/metric-agreement-findings.md)
- [Public RoboRewardBench prediction and PPI findings](docs/public-prediction-ppi-findings.md)
- [Frozen local-review pilot findings](docs/pilot-findings.md)
- [Full reproduction contract](docs/reproducibility.md)

The checked-in summary is a reviewable index transcribed from the dated reports. Raw benchmark predictions and normalized RoboArena metadata remain outside Git, so the empirical totals are not claimed as independently recomputed from files committed here.

## Working contribution: a fail-safe policy certificate

`roboeval certify` implements the conservative baseline proposed by the research:

1. Freeze the policy graph, evaluator, practical margin, and error target.
2. Audit evaluator utility, bias, and supported shift strata using held-out human labels.
3. Keep audit sessions separate from policy-inference sessions.
4. Use fixed PPI only when every prespecified policy edge passes the audit gate.
5. Otherwise return the exact frozen human-only estimate and interval.
6. Report simultaneous Bonferroni intervals and one of four decisions: candidate superior, baseline superior, practically equivalent, or unresolved.

The implementation fails closed on session leakage, missing policy edges, weak proxies, biased proxies, and supported shift failures. It is a transparent normal-approximation baseline, not a graph-aware coverage theorem.

## Verify it in two minutes

Node.js 22 or newer is the only runtime dependency.

```powershell
npm.cmd ci
npm.cmd run check
npm.cmd run demo:certificate
```

`npm run check` verifies the external-data boundary, required research artifacts, documentation links, and the complete automated test suite.

The zero-download certificate demonstration runs two synthetic cases:

- a helpful proxy must enter the fixed-PPI branch; and
- a harmful proxy must abstain, with every estimate and interval exactly matching the human-only branch.

The input contract and explicit non-guarantees are documented in [docs/certificate-input.md](docs/certificate-input.md).

## Use the CLI

### Compare two policies using matched evidence

```powershell
node .\bin\roboeval.js compare `
  --input C:\path\to\evidence.jsonl `
  --baseline policy-a `
  --candidate policy-b
```

The result includes the observed paired effect, a 95% interval, `P(candidate > baseline)`, a STOP/TEST decision, and a bounded next-evidence recommendation.

### Audit an automatic judge

```powershell
node .\bin\roboeval.js audit-judge `
  --input C:\path\to\evidence.jsonl `
  --group-by policy,task,site
```

### Run the conservative certificate

```powershell
node .\bin\roboeval.js certify `
  --input C:\path\to\certificate-frame.json
```

### Import public RoboArena metadata

Keep the 21.7 GB official dataset outside this repository. The first-stage importer reads YAML metadata and filenames only; it does not load or copy videos or NPZ contents.

```powershell
node .\bin\roboeval.js fetch-roboarena-metadata `
  --target C:\path\outside\this-repository\DataDump_07-17-2026

node .\bin\roboeval.js import-roboarena `
  --data-root C:\path\outside\this-repository\DataDump_07-17-2026 `
  --output C:\path\outside\this-repository\normalized.jsonl
```

Detailed commands for the public-prediction study and full empirical reproduction are in [docs/reproducibility.md](docs/reproducibility.md). The local-judge study and its observed limits are documented in [docs/local-judge-feasibility.md](docs/local-judge-feasibility.md); all available CLI workflows are listed by `node .\bin\roboeval.js help`.

## Evidence schema

Normalized evidence is JSON Lines with one policy observation per row:

```json
{
  "schema_version": 1,
  "trial_id": "session-id:A",
  "comparison_id": "session-id",
  "policy": "policy-a",
  "task": "open the drawer",
  "site": "lab-1",
  "timestamp": "2026-01-01T00:00:00Z",
  "automatic_judge": { "score": 0.62, "success": true },
  "human": { "score": 0.8, "success": true, "source": "human-review" },
  "video_paths": ["evaluation_sessions/session-id/A_policy/video_wrist.mp4"],
  "source": { "dataset": "example", "metadata_path": "session-id/metadata.yaml" }
}
```

`automatic_judge` and `human` may independently be `null`. Missing judge evidence is reported rather than inferred from human success or preference. A matched comparison requires evidence for both selected policies.

## Repository map

```text
bin/        CLI entry point
src/        evidence parsing, inference, auditing, judging, and certification
test/       deterministic unit, integration, negative, and adversarial tests
scripts/    reproducible study, review, retrieval, and integrity workflows
results/    lightweight evidence index; no raw datasets
docs/       research design, findings, ADRs, limitations, and reproduction
```

Start with the [documentation map](docs/README.md) for the shortest route to the research summary, evidence, method, and deeper technical material.

## What is established and what remains open

### Established in this repository

- Real matched-policy analyses show that metric and evaluator choice can change policy conclusions.
- Public VLM predictions can help or harm label efficiency depending on the evaluator.
- The conservative separated-audit certificate is executable, deterministic, and fail-closed under tested failure modes.
- Raw datasets and generated evidence are kept outside Git and guarded by an automated boundary check.
- Empirical findings carry explicit provenance and claim boundaries.

### Open research

- Verify simultaneous coverage under clustered, heterogeneous, missing, and shifted proxy errors.
- Collect independent blinded multi-rater references and measured review time.
- Freeze a defensible practical-equivalence margin and worthwhile cost threshold before confirmatory labels are inspected.
- Test generalization on a new task, site, policy, robot, or institution.
- Determine whether a cross-fitted graph-aware method can provide a stronger coverage or no-harm guarantee than the conservative baseline.

These open questions separate engineering feasibility from the eventual scientific claim. The intended MASc/MSc contribution is a locked multi-rater and shift validation of the conservative method; a graph-aware validity/no-harm theorem is a deeper, conditional extension.

## Claim boundary

This project does **not** claim:

- that a VLM is robot ground truth;
- that a released benchmark reference is independent multi-rater gold;
- that exploratory model selection generalizes to future robots or tasks;
- that PPI always saves human labels;
- that the current normal approximation is a graph-aware finite-sample theorem; or
- that the software certifies physical safety or acts as a deployment gate.

The complete research design, literature boundary, estimand, validation plan, and stopping rules are in the [research summary](docs/research-summary.md) and [thesis proposal](docs/thesis-proposal.md).

## Data boundary

Raw datasets, videos, arrays, archives, judgments, public prediction downloads, and generated empirical outputs must remain outside Git. `npm run check:data-boundary` fails if a common raw-data payload or a file larger than 5 MiB appears in the repository.

The metadata fetch checks out YAML only with Git LFS media smudging disabled, verifies the session count, and removes transport-level Git metadata from the external target. Git is required only for that fetch command.

## Citation and license

The software is released under the [MIT License](LICENSE). Citation metadata is available in [CITATION.cff](CITATION.cff).

**Research author:** Jaya Krishna J

**Version:** 0.1.0

**Evidence status:** exploratory validation with an executable conservative baseline
