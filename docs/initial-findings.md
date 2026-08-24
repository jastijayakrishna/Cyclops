# Initial findings — 2026-08-11

These are exploratory engineering checks, not preregistered confirmatory results.

## Source and normalization

- Source: [`RoboArena/DataDump_07-17-2026`](https://huggingface.co/datasets/RoboArena/DataDump_07-17-2026), retrieved 2026-08-11.
- The official card reports 3,883 evaluation sessions, 10,783 policy episodes, and 21.7 GB total media/array content.
- The metadata-only external slice normalized to exactly 3,883 sessions and 10,783 policy records.
- Four sessions contain one policy rather than a pair. They remain in normalized provenance but cannot enter matched comparisons.
- All normalized policy episodes contain a human binary or partial-success outcome.
- No session contains an automatic-judge result. Judge bias and calibration are therefore not identifiable from this public dump alone.

## First real matched comparison

Command:

```powershell
node .\bin\roboeval.js compare `
  --input C:\Users\krish\Downloads\roboarena-data\normalized-07-17-2026.jsonl `
  --baseline paligemma_fast_droid `
  --candidate paligemma_fast_specialist_droid `
  --iterations 20000 `
  --seed 20260811
```

Observed result across 802 matched sessions:

| Measure | Result |
|---|---:|
| Candidate minus baseline binary success | +1.4 percentage points |
| Posterior mean improvement | +1.4 percentage points |
| 95% credible interval | −1.6 to +4.4 percentage points |
| `P(candidate > baseline)` | 81.7% |
| Decision at 95% threshold | Insufficient evidence |

This establishes that the comparison engine can produce a defensible “not enough evidence” result on the real matched design. It does **not** establish judge bias, evidence-cost savings, policy superiority, or a product outcome.

The current next-batch estimate is exploratory. The frozen task taxonomy, trial/label cost model, target policy population, practical-effect threshold, and sequential evaluation protocol must be specified before claiming the recommendation is cost-optimal.

## Next evidence-based decision

The highest-value next input is a paired machine/human judge table for the existing videos, ideally sampled under a frozen labeling protocol. Without it, Experiment 1 (judge bias), Experiment 2 (decision changes), and Experiment 3 (human-label reduction) cannot be run. The 21.7 GB media should remain undownloaded until a concrete local or external automatic judge requires video bytes.

