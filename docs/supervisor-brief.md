# Decision-safe auto-evaluation of robot policies

**Jaya Krishna J — research prospectus — 24 August 2026**

## The research opportunity

Vision-language models can score robot videos cheaply, but episode accuracy does not answer the decision a robotics lab must make: which policy is superior, practically equivalent, or still unresolved, and how much human evidence is enough. Structured evaluator errors can look small on average while reversing a matched policy effect.

This project asks:

> Can a fail-safe policy-decision certificate use VLM judgments to reduce human review while preserving simultaneous error control—and automatically abstain to human-only inference when the evaluator is weak, inconsistent, or shifted?

The VLM is optional auxiliary evidence, not ground truth. The proposed certificate separates an evaluator-audit subset from the labels used for policy inference. If prespecified utility, consistency, or shift gates fail, the output is exactly the frozen human-only procedure.

## Why this is a research contribution

PPI, active label allocation, and model-assisted ranking already exist. SureSim already applies PPI to robot evaluation using simulation. Prediction-Powered Ranking combines model and human pairwise judgments, while Eval-Actions and TrustRoboReward advance fine-grained and multi-paradigm robot rewards. The contribution is therefore not “PPI for robotics” or another reward model.

The candidate gap is their decision-safe integration for video-based robot policy evaluation:

1. simultaneous uncertainty over a graph of policies that share matched sessions;
2. repeated camera views aggregated inside episodes rather than counted as independent trials;
3. a separated evaluator gate with an exact human-only fallback;
4. blinded multi-rater references that retain ambiguity; and
5. abstention and coverage testing under held-out task/site shift.

This is a proposal-level novelty claim, not universal priority. A supervisor-led systematic review remains a prerequisite for publication.

The literature bar is now higher than this integration alone: post-hoc regression, multiple-predictor PPI, adaptive routing, prediction-powered e-values, and reliable model-guided selection all occupy adjacent territory. The repository therefore treats the separated certificate as the **verified conservative baseline**. A PhD claim requires a new cross-fitted graph-aware coverage/no-harm guarantee; an MASc/MSc claim can center on rigorous multi-rater and shift validation of the conservative method.

## Preliminary evidence already produced

- **Metric choice changes conclusions.** Across 3,879 matched RoboArena sessions and 28 policy pairs, switching from binary success to human preference moved `P(candidate better)` by 13.0 points on average (95% interval: 6.4-19.6) and changed seven decisions. Both policies failed in 81.8% of sessions.
- **VLM errors reach the policy level.** Twenty-five released RoboRewardBench runs were joined to 158 matched RoboArena sessions. All 24 models with complete twenty-pair coverage changed at least one descriptive 95% decision relative to the benchmark reference.
- **Automated label value is conditional.** Only five of 25 runs improved the median fixed-PPI residual-variance criterion. A post-hoc RoboReward 8B example improved interval width and reconstruction error by roughly 14-15%; Gemini 2.5 Flash-Lite made both roughly 25% worse.

These are exploratory results because released test artifacts informed method selection. Their purpose is to establish feasibility, reveal failure modes, and design a locked validation.

## Proposed method and decision rules

Policies form a prespecified comparison graph. Each edge receives a simultaneous 95% confidence interval for its multi-rater candidate-minus-baseline effect. With practical-equivalence margin `delta`, the output is:

- `candidate superior` if the lower bound exceeds `delta`;
- `baseline superior` if the upper bound is below `-delta`;
- `practically equivalent` if the interval lies inside `[-delta, delta]`; or
- `unresolved` otherwise.

The primary efficiency outcome is human labels and measured review minutes needed to reach maximum simultaneous half-width `w* = delta / 2`. A positive result requires nominal simultaneous coverage, a prespecified worthwhile cost reduction, and no increase in unsupported superiority declarations. Evaluator rejection is a valid thesis result.

### What already runs

`roboeval certify` now executes the conservative split-sample baseline. It verifies frozen population membership, rejects session leakage, requires inference support for every edge, uses deterministic bootstrap utility/bias gates, applies fixed `lambda = 1` PPI only after all edges pass, and otherwise returns the identical frozen human-only estimate and interval. Adversarial tests cover helpful and harmful proxies, multiplicity, determinism, leakage, and missing edges. The current Bonferroni-normal intervals are deliberately labeled a baseline, not a graph-aware theorem.

## Validation that does not depend on luck

**Guaranteed minimum track:** stable public RoboArena/RoboReward artifacts plus new blinded ratings on a prespecified reference subset, subject to licensing, budget, and ethics/data-use determination. At least three raters per selected episode score observable progress with randomized policy order and an allowed `indeterminate` response. This supports internal validation and reference-reliability findings, not external generalization.

**Preferred external track:** a prospective laboratory frame containing new tasks, policies, sites, or robot conditions, kept blinded until protocol lock. This is the frame that can support an external-confirmation claim.

## Degree-calibrated scope

- **MASc/MSc:** completed distortion audit + separated fail-safe certificate + simulation coverage verification + internal multi-rater validation.
- **PhD:** prove a cross-fitted graph-aware simultaneous validity/no-harm result and validate it across more than one sampling frame. Without that or an equally deep contribution, the honest scope is MASc/MSc.

The project does not require training a new foundation model, building a broad benchmark, or controlling a robot.

## Research assets already built

The repository includes deterministic matched-policy inference, reference-aware calibration, finite-population PPI simulation, the executable graph certificate, two-phase adjudication tools, a CLI, data-boundary enforcement, hashed public-artifact retrieval, and adversarial automated tests. Exact test and coverage totals are regenerated before outreach rather than frozen in this brief.

## The supervision decision

The highest-value discussion is not whether VLM judges are promising in general. It is:

> Does a separated, abstaining policy-decision certificate align with the lab’s research, and which evaluation frame would make its claim scientifically decisive?

Full proposal: `docs/thesis-proposal.md`. Reproduction contract: `docs/reproducibility.md`. Exploratory summary: `results/exploratory-summary.json`.
