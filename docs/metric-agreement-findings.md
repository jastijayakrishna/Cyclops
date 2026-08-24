# Human metric choice changes a quarter of policy decisions

Status: completed 2026-08-12. Reproduce with

```powershell
node .\scripts\metric-agreement-study.js `
  --population C:\path\normalized-07-17-2026.jsonl
```

No API calls, no media downloads, no new labels. Seed 20260812, 20,000 iterations,
95% decision threshold, minimum 50 matched sessions per pair.

## What was compared

RoboArena carries two independent human judgments per session and the project had
only been using one:

- **binary task success**, recorded per policy, and
- **A/B/TIE preference**, recorded once per session.

The session-level `preference` field names the A or B slot only, so it is
interpretable for exactly the two policies in those slots — a seven-policy session
still yields one preference comparison, not twenty-one. That gives 3,879 usable
sessions out of 3,883, covering 28 policy pairs with at least 50 matched sessions.

Both metrics were computed on **identical sessions** for each pair, so the contrast
isolates the metric and not the sample.

## Validity checks

| Check | Result | Verdict |
|---|---|---|
| Slot-position bias | A preferred 1,666 / B preferred 1,661 (50.1% of decided); success by slot 11.0% vs 10.4% | pass |
| Metric coherence | On the 586 sessions where exactly one policy succeeded, preference agreed with it 583 times (99.5%) and never picked the failed policy | pass |
| Metric saturation | 3,172 of 3,879 sessions (81.8%) had **both** policies fail | see below |

The coherence check matters: preference is not a noisy second opinion that
contradicts success. Where binary success discriminates at all, preference agrees
with it 99.5% of the time and disagrees 0% of the time.

## Result

| Endpoint | Value | 95% interval |
|---|---:|---|
| **Primary** — mean absolute shift in `P(candidate better)` | **13.0 points** | [6.4, 19.6] |
| Max shift on any pair | 62.0 points | — |
| **Secondary** — decision flips | **7 / 28 (25.0%)** | [10.7%, 44.9%] exact |
| Ranking sign reversals | 3 / 28 (10.7%) | — |

The primary interval excludes zero. Minimum detectable flip rate at 28 pairs is
21.9%, so the observed 25% clears it, but only just and with a wide interval; the
primary endpoint carries the conclusion.

Four flips move `INSUFFICIENT EVIDENCE` to `CANDIDATE BETTER`, two move
`CANDIDATE BETTER` to `INSUFFICIENT EVIDENCE`, one moves `BASELINE BETTER` to
`INSUFFICIENT EVIDENCE`. Preference is generally the more decisive metric.

## Mechanism

This is not two evaluators disagreeing. It is one metric being saturated.

81.8% of sessions had both policies fail, and binary success cannot separate a pair
when neither side succeeds — those sessions enter the paired comparison as ties and
contribute nothing. Humans still named a winner in 84.3% of exactly those sessions.
Preference recovers graded quality information that binary success discards.

The `paligemma_binning_droid` pairs show this most starkly: binary success puts it
9–14 points behind its opponents, while preference puts it 86–99 points behind.
Both policies usually fail, so success cannot see the gap that humans see easily.

## What this does and does not establish

**Does:** on real RoboArena data, across 28 policy pairs with a preregistered
threshold and a powered primary endpoint, the choice of human evaluation metric
moves `P(candidate better)` by 13 points on average and changes the decision on a
quarter of pairs. The premise underneath the judge-calibration thesis — that
evaluation methodology materially distorts policy conclusions — holds on this
dataset, and the mechanism is identified.

**Does not:** say anything about automatic judges. Both metrics here are human. No
machine judge has been run on this data, so judge bias, calibration benefit, and
human-label savings all remain untested. It also does not establish that preference
is the *correct* metric; it establishes that the two disagree and that binary
success is the coarser of the two.

## Follow-up completed 2026-08-13

New inference is no longer required for the general machine-judge question. Public
RoboRewardBench predictions have now been joined to the original session/policy
structure and analyzed in [public-prediction-ppi-findings.md](public-prediction-ppi-findings.md).
The exact frozen binary/eight-frame Gemini prompt remains untested, because the public
benchmark uses a different full-video 1-5 progress contract.
