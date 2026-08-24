# Frozen RoboArena pilot: local manual-review findings

Status: exploratory validation result, completed 2026-08-11.

## Outcome

All 200 blinded wrist videos from 100 matched sessions were reviewed locally without an API key. The reviewer saw only the task instruction, video, and uniformly sampled frames; policy identity, site, and RoboArena outcomes remained hidden until analysis.

The local review reverses the policy ranking relative to the RoboArena reference labels, but it does not change the threshold decision:

| Measure | Local blinded review | RoboArena human labels |
|---|---:|---:|
| Candidate improvement | -6.9 percentage points | +2.0 percentage points |
| 95% interval | [-18.0, +4.4] points | [-6.5, +10.3] points |
| P(candidate > baseline) | 10.9% | 67.9% |
| Decision at 95% threshold | insufficient evidence | insufficient evidence |

The human-minus-review correction is +8.8 percentage points, and the posterior probability moves by +57.0 points. For this single policy pair, ranking distortion is 1/1 and decision distortion is 0/1. Neither value is a generalizable rate because the pilot contains only one A/B pair.

The full 802-session RoboArena human comparison remains +1.4 points with a 95% interval of [-1.6, +4.4], P(candidate > baseline) = 81.7%, and insufficient evidence.

## Judge audit

Across 200 videos, the local review produced 26 true positives, 39 false positives, 8 false negatives, and 127 true negatives against the RoboArena reference labels. That is 76.5% raw agreement, a 23.5% false-positive rate, and a 23.5% false-negative rate.

The policy-specific error rates favor the baseline in both directions:

| Policy | False-positive rate | False-negative rate |
|---|---:|---:|
| `paligemma_fast_droid` | 27.4% | 18.8% |
| `paligemma_fast_specialist_droid` | 19.5% | 27.8% |

The absolute policy gaps are 7.9 points for false positives and 9.0 points for false negatives. These sample estimates have substantial uncertainty, especially for false negatives because the reference-success denominators are only 16 and 18.

The manual verdict distribution was 65 complete, 64 partial, 25 wrong action, 22 not visible, 21 no progress, and 3 aborted.

## Human-label efficiency

Randomly revealing a subset of the RoboArena labels did not reliably reconstruct the full-human effect:

| Revealed human sessions | Valid repetitions | Reconstruction rate | Ranking agreement | Decision agreement | Median effect error |
|---:|---:|---:|---:|---:|---:|
| 10% | 47/50 | 2.1% | 63.8% | 100.0% | 6.7 points |
| 20% | 50/50 | 14.0% | 60.0% | 96.0% | 5.0 points |
| 50% | 50/50 | 20.0% | 70.0% | 100.0% | 2.8 points |

The high decision-agreement rates are not evidence of successful reconstruction: the 95% decision threshold usually returns insufficient evidence. The reconstruction and ranking measures show that this run has not demonstrated a 5-20% human-label solution.

## Protocol amendment and limits

The frozen protocol named `gemini-2.5-flash-lite`. At the user's direction, the completed run substituted local manual review and made no API calls. Therefore this result supports a claim about review-versus-reference distortion under the documented local rubric; it does not support a claim about Gemini bias.

The existing 18-row partial Gemini file was preserved separately. On that non-random incomplete subset, Gemini and the local review agreed on 7/18 binary verdicts (38.9%). This is diagnostic only and must not be presented as a full-pilot comparison.

RoboArena labels are treated as reference labels, not infallible ground truth. Ambiguous visibility and partial-success semantics could explain part of the disagreement. Site-level rates are too sparse for strong site claims.

## Amendment 2026-08-12: three estimand corrections

Reproduced by `node scripts/reanalyze-with-fixed-endpoints.js`. The numbers above are
arithmetically correct and were reproduced exactly; the corrections concern what they
identify, not their computation.

**1. The adjudication plan named below is not identifiable.** Adjudicating only the 47
disagreements leaves the two agreement strata (26 machine-success/reference-success and
127 machine-failure/reference-failure) with sampling probability zero. Their gold error
rate is unknown and cannot be reweighted, so no corrected false-positive or
false-negative rate can be recovered from that design at any sample size. This is
verification bias. The fix is two-phase stratified sampling across all four cells with
recorded per-cell probabilities and Horvitz-Thompson reweighting (`src/two-phase.js`).
The same 47-item budget reallocated as 6/9/2/30 across the four strata is identifiable.

**2. The published error rates are the classical direction; calibration uses the other
one.** The 23.5%/23.5% figures are `P(machine success | reference failure)` and
`P(machine failure | reference success)`. Both landing on 23.5% is a coincidence of
39/166 and 8/34. But `compare --calibrate` learns `P(human success | automatic verdict)`,
whose sample values are **60.0%** and **5.9%**. In the direction the calibration model
actually consumes, this judge is roughly ten times asymmetric — it over-calls success
heavily and rarely misses one — which the symmetric-looking published pair conceals.

**3. These are disagreement rates, not error rates.** RoboArena reference labels are
single-rater, and the local review was also single-rater, so neither side is ground
truth and a disagreement does not establish which one is wrong. `src/gold-labels.js`
now refuses to emit a judge error rate without adjudicated gold labels from at least
two independent raters, reports Fleiss' kappa, and leaves rater ties unresolved rather
than breaking them silently.

**4. Ranking and decision distortion were measured on the least informative pair.** Of
the 28 policy pairs with at least 50 matched sessions, 20 are decisive at the 95%
threshold and 8 are not; 9 sit in a band where a moderate correction could plausibly
cross the line. The pilot pair sat at P = 81.7%, roughly the flattest point available.
A flip rate over 9 pairs has a minimum detectable rate of 46.6% at 80% power, and an
observed 3/9 would carry an exact 95% interval of [7.5%, 70.1%] — so flip rate cannot
support a conclusion at this scale and is now demoted to a secondary endpoint. The
primary endpoint is the mean absolute posterior shift (`src/power.js`).

On the one pair with paired labels, that continuous endpoint tells the opposite story
from the flip rate. Treating the machine labels as truth gives P = 11.2%; calibrating
with 20% of human labels revealed gives 31.6%, with 50% gives 56.4%, and all human
labels give 67.6%. The mean absolute posterior shift is **32.8 points** (max 45.2) while
the decision stays `INSUFFICIENT EVIDENCE` throughout. The old endpoint scores this as
0/1 — no effect. The corrected endpoint scores a 32.8-point correction. Same data.

The `STRONG_SIGNAL` gate below rests on a ranking reversal observed on one pair with
single-rater labels on both sides. It should be read as a reason to run the multi-pair
protocol, not as an established distortion rate.

## Decision

The preregistered exploratory gate is `STRONG_SIGNAL` because the ranking reverses. The result justifies investigating evaluator/rubric distortion, but it does not yet justify expanding to every policy pair or claiming human-label cost savings.

The smallest credible next evidence is independent adjudication of the 47 review/reference disagreements, blinded to both policy and original labels. A full Gemini conclusion still requires the frozen 200-video model run if API use is later authorized. Hardware and unrelated platform work remain outside scope.

## Follow-up completed 2026-08-13

The broader machine-evaluator question no longer depends on finishing this exact
Gemini run. Released RoboRewardBench predictions now provide multi-model, full-video
1-5 progress evidence and are analyzed in
[public-prediction-ppi-findings.md](public-prediction-ppi-findings.md). They do not
retroactively complete the frozen eight-frame binary prompt, and independent
adjudication is still required before calling either reference-relative disagreement
an absolute judge error.
