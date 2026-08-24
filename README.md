# Robot Evaluation Decision Engine

**Research author:** Jaya Krishna J  
**Status:** validated research software with exploratory findings and a proposed independent confirmation

`roboeval` answers one bounded question: given a baseline policy and a candidate policy, is the candidate better, how uncertain is that conclusion, and what is the cheapest useful evidence to collect next?

This repository is a validation-grade implementation. It supports matched RoboArena comparisons, deterministic Bayesian uncertainty estimates, honest judge calibration when paired judge/human labels exist, and STOP/TEST guidance. It does **not** claim that the public RoboArena dump contains automatic-judge labels: as of the 2026-07-17 snapshot, its session metadata contains human preference and per-policy binary/partial success.

## Professor-facing research package

Start here if you are evaluating the project as thesis research:

- [Supervisor brief](docs/supervisor-brief.md) — two-page research case, evidence, confirmatory design, and supervision question.
- [Formatted faculty brief](docs/professor-brief.docx) — meeting-ready Word version of the research case.
- [Thesis proposal](docs/thesis-proposal.md) — hypotheses, state of the art, estimand, statistical protocol, ethics, limitations, and twelve-month plan.
- [Research pitch deck](docs/roboeval-thesis-pitch.pptx) — concise presentation for a faculty meeting.
- [Reproducibility contract](docs/reproducibility.md) — repository-level and full empirical reproduction.
- [Machine-readable evidence index](results/exploratory-summary.json) — exploratory results with explicit provenance and claim boundaries.
- [Defense questions](docs/defense-questions.md) — direct answers to likely novelty, validity, and inference challenges.
- [Research roadmap](docs/research-roadmap.md) — two-track evidence plan, degree boundary, and decision gates.
- [Fail-safe certificate ADR](docs/adr-0003-fail-safe-policy-certificate.md) — separated evaluator gating, human-only fallback, and guarantee boundaries.
- [Professor red-team review](docs/professor-red-team-review.md) — candid simulated supervision verdict and the bar for MASc/MSc versus PhD novelty.
- [Faculty-fit map](docs/faculty-fit-map.md) — current Waterloo/U of T research alignment and outreach constraints.
- [Certificate input and claim boundary](docs/certificate-input.md) — runnable conservative baseline contract and explicit non-guarantees.

The central claim is deliberately bounded: episode-level VLM accuracy is not sufficient to establish policy-level decision fidelity. A frozen evaluator may enter simultaneous policy inference only after an independent audit gate; otherwise the certificate abstains to the exact human-only procedure. Savings require coverage, measured review-cost, and unsupported-declaration gates to pass.

The conservative thesis baseline is executable through `roboeval certify`. It checks frozen population membership, session-disjoint audit/inference labels, complete edge support, deterministic proxy gating, simultaneous Bonferroni intervals, and identity with the frozen human-only branch after abstention. It is feasibility evidence—not a claimed graph-aware or physical-safety theorem.

The completed local-review pilot and its limitations are documented in [docs/pilot-findings.md](docs/pilot-findings.md). The no-inference machine-judge study is complete in [docs/public-prediction-ppi-findings.md](docs/public-prediction-ppi-findings.md), and the supervisor-ready research framing is in [docs/thesis-proposal.md](docs/thesis-proposal.md). Large datasets, selected videos, judgments, public prediction artifacts, and generated evidence stay outside Git.

## Public machine-judge study (no Ollama and no new labels)

RoboRewardBench publishes raw progress predictions from 25 model runs on a 1,000-view RoboArena subset. Fetch only those public JSON artifacts to an external directory, then join them to the original matched policy sessions:

```powershell
node .\scripts\fetch-roboreward-bench.js `
  --target C:\Users\you\Downloads\roboarena-data\roboreward-bench-v0.0.1

node .\scripts\public-prediction-ppi-study.js `
  --population C:\Users\you\Downloads\roboarena-data\normalized-07-17-2026.jsonl `
  --benchmark-root C:\Users\you\Downloads\roboarena-data\roboreward-bench-v0.0.1 `
  --output C:\Users\you\Downloads\roboarena-data\roboreward-bench-v0.0.1\policy-ppi-results.json
```

This path downloads no videos and performs no model inference. It aggregates camera views within policy episodes, compares 1-5 VLM progress against the human-verified benchmark reference at the matched-session level, and simulates fixed and adaptive prediction-powered reconstruction. The public judge contract is not the frozen binary/eight-frame pilot prompt, and the single-verifier references are not described as independent gold.

To analyze a non-default result file without overwriting the frozen Gemini artifacts:

```powershell
node .\bin\roboeval.js pilot-analyze `
  --pilot-dir C:\path\to\external-pilot `
  --population-input C:\path\to\external-normalized.jsonl `
  --results-file manual-judge-results.jsonl `
  --output-prefix manual-pilot
```

## Data boundary

The official RoboArena snapshot is 21.7 GB and must remain outside Git. Keep it in a sibling or otherwise external directory, for example:

```text
C:\Users\you\Downloads\
├── REDE\                         # this repository
└── roboarena-data\
    └── DataDump_07-17-2026\      # external dataset
```

The repository ignores common dataset directories and raw video/array/archive formats. `npm run check:data-boundary` also fails if a raw dataset payload or a file larger than 5 MiB appears in the repository. This is a guardrail, not a substitute for reviewing `git status` before committing.

## Quick start

Node.js 22 or newer is the only runtime dependency.

```powershell
npm.cmd test

# Fetch only the real session YAML required by this milestone. This target is
# enforced to be outside the repository; media and NPZ files are not downloaded.
node .\bin\roboeval.js fetch-roboarena-metadata `
  --target C:\Users\you\Downloads\roboarena-data\DataDump_07-17-2026

node .\bin\roboeval.js import-roboarena `
  --data-root C:\Users\you\Downloads\roboarena-data\DataDump_07-17-2026 `
  --output C:\Users\you\Downloads\roboarena-data\normalized.jsonl

node .\bin\roboeval.js compare `
  --input C:\Users\you\Downloads\roboarena-data\normalized.jsonl `
  --baseline paligemma_fast_droid `
  --candidate paligemma_fast_specialist_droid
```

Use `ROBOEVAL_DATA_ROOT` instead of `--data-root` if preferred. Import reads only `global_metadata.yaml`, per-session `metadata.yaml`, and filenames; it never loads video or NPZ contents.

The metadata fetch obtains one Git pack with LFS media smudging disabled, checks out only YAML, verifies the session count against `global_metadata.yaml`, and removes the external checkout's `.git` directory. This avoids Windows-incompatible `:` characters in upstream media filenames and avoids transferring media that the first milestone does not consume. Git is required only for this fetch command. A full media download can be added later, to a non-Windows filesystem or with filename remapping, only when a video judge is actually part of the experiment.

## Local judge (no API key, no egress)

`pilot-judge-local` runs the same frozen prompt and verdict schema as the hosted
judge against a vision model served on this machine, so a judge run costs nothing
and sends nothing off the box. Frames are sampled with a bundled ffmpeg
(`python -m pip install imageio-ffmpeg`); results land in
`local-judge-results.jsonl` and never overwrite an API run.

```powershell
ollama pull qwen2.5vl:7b   # note: "qwen2.5" is the text model and cannot see frames

node .\bin\roboeval.js pilot-judge-local `
  --pilot-dir C:\path\to\pilot --model qwen2.5vl:7b --frames 8

node .\bin\roboeval.js pilot-analyze `
  --pilot-dir C:\path\to\pilot --population-input C:\path\normalized.jsonl `
  --results-file local-judge-results.jsonl --output-prefix local
```

A verdict whose confidence is below 0.5 is rejected rather than recorded: scored
as `P(success)`, such a row lands on the opposite side of the label the model just
emitted and would invert calibration downstream. Small models hit this constantly,
so a run that fails this way is reporting a real problem with the judge, not a bug.

To inspect machine-judge error rates on a normalized file that actually contains paired machine/human observations:

```powershell
node .\bin\roboeval.js audit-judge --input C:\path\evidence.jsonl --group-by policy,task,site
node .\bin\roboeval.js compare --input C:\path\evidence.jsonl --baseline policy-a --candidate policy-b --calibrate
```

`--calibrate` fails closed unless every compared policy has enough paired labels and observations from both automatic verdict classes. It never silently substitutes uncalibrated machine labels.

## Normalized evidence schema

One JSON object per line:

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

`automatic_judge` and `human` may independently be `null`, but a comparison needs evidence for both selected policies. Video paths are provenance strings; videos are never copied into normalized output.

## Decision semantics

- Comparisons use sessions containing both selected policies, preserving RoboArena's matched task/site design.
- Single-policy or incomplete sessions are retained for provenance and reported at import, but cannot enter a matched comparison.
- Human-only comparisons use a Jeffreys-prior Dirichlet posterior over the four paired binary outcomes.
- Calibrated comparisons learn `P(human success | automatic verdict)` separately for each policy, propagate calibration uncertainty, and use human labels directly when present.
- The default decision threshold is 95% posterior probability. Otherwise the result is `INSUFFICIENT EVIDENCE` and the planner recommends human labels before robot trials when useful unlabeled machine evidence exists.
- Trial/task guidance is explicitly exploratory until the experiment supplies a frozen task taxonomy and evidence-cost model; it is not yet a proven cost-optimal allocation policy.
- Monte Carlo results are deterministic for a fixed input and seed.

This is decision support for a research validation, not a safety certification system or a deployment gate.
