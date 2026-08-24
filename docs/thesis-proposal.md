# Decision-safe auto-evaluation of robot policies under imperfect human and vision-language judgments

**Author:** Jaya Krishna J  
**Maturity:** Validate  
**Proposal status:** research-grade prospectus with executable conservative baseline  
**Evidence status:** completed exploratory retrospective analysis; confirmatory replication proposed  
**Version:** 2026-08-24

## Abstract

Vision-language models (VLMs) can score robot videos at far lower marginal cost than repeated expert review, but episode-level benchmark accuracy does not answer the decision a robotics researcher actually faces: which policy is superior, practically equivalent, or still unresolved, and how much human evidence is required before making that declaration. This thesis develops a fail-safe policy-decision certificate that treats VLM judgments as optional auxiliary evidence rather than ground truth. The procedure must abstain to human-only inference when an evaluator is weak, inconsistent, or shifted.

The completed feasibility analysis joins 25 released HELM RoboRewardBench model runs to the original RoboArena session and policy structure. It covers 1,000 camera views, 676 policy episodes, 158 matched sessions, eight policies, twelve sites, and twenty policy pairs with at least fifty shared sessions for 24 models. Each of those 24 models changes at least one descriptive 95% policy decision relative to the human-verified benchmark reference. Label efficiency is not universal: fixed PPI improves the median residual-variance criterion for only five of 25 released runs. In the strongest released RoboReward 8B run selected post hoc, fixed PPI retains approximately 95% repeated-sampling coverage while reducing interval width and mean absolute reconstruction error by roughly 14-15%. For Gemini 2.5 Flash-Lite, the same correction increases both by roughly 25%.

The strengthened thesis has an evidence ladder rather than one inflated claim. The repository now implements the conservative baseline: simultaneous Bonferroni policy intervals, a session-disjoint evaluator audit, fixed PPI only after every prespecified edge passes, and an identical human-only fallback. The MASc/MSc contribution is a locked, multi-rater evaluation of whether that certificate reduces review time without unsupported declarations. The PhD contribution is deliberately harder: a graph-aware, cross-fitted procedure with a formal coverage and high-probability no-harm guarantee under clustered, heterogeneous proxy error. The primary efficiency outcome is human-review time required to reach a prespecified simultaneous precision target. A guaranteed public-data validation track does not depend on a future benchmark release; a prospective laboratory frame is the preferred external-validation extension.

## Problem and significance

Robot-policy benchmarks increasingly use automated video scoring because physical trials and human review are expensive. However, a model can have acceptable mean episode accuracy while introducing structured errors by task, site, policy, or progress level. Those errors can cancel in one comparison and amplify in another. Consequently, average benchmark accuracy is not sufficient evidence that a VLM can safely substitute for human-reference outcomes in policy selection.

This distinction matters for three reasons. First, policy ranking is the downstream scientific decision, so evaluation quality should be measured at that level. Second, incorrect confidence can cause a researcher to stop an evaluation too early or allocate scarce robot trials to the wrong comparison. Third, label-efficient inference is valuable only if it retains coverage; a narrower but under-covering interval is not a saving.

The project therefore treats the VLM as an auxiliary measurement instrument, not an oracle. Its value is conditional and testable. A useful evaluator should reduce the residual variance of the human-reference policy effect. A harmful evaluator should be rejected without concealing the negative result.

## Research questions and hypotheses

### Research question 1 — policy-decision distortion

> How do VLM judgment errors propagate into simultaneous superiority, equivalence, and rank conclusions across a graph of matched real-robot policy comparisons?

**H1 — decision-level distortion.** Naive VLM substitution will produce a larger maximum standardized policy-effect discrepancy and more unsupported superiority declarations than human-only inference on the prespecified policy graph, even for evaluators with competitive episode-level accuracy.

The primary scientific output is a simultaneous 95% confidence set for the vector of policy-pair effects. The primary distortion summary is the maximum standardized difference between automated and multi-rater-reference policy effects across prespecified edges. Decision changes and sign reversals remain secondary because “at least one change” is multiplicity-sensitive.

### Research question 2 — fail-safe augmentation

> Can a prespecified VLM reduce the human-review time required for simultaneous policy decisions while retaining error control and abstaining when it cannot help?

**H2 — conditional efficiency.** When an evaluator passes a gate computed on a held-out audit subset, fixed prediction-powered inference on the separate inference subset will require fewer human-review minutes than human-only estimation to reach the prespecified simultaneous precision target, while retaining at least nominal 95% simultaneous coverage within Monte Carlo tolerance.

**Fail-safe null.** If residual-variance improvement, consistency, or shift checks fail, the certificate returns the prespecified human-only procedure. Gate labels and inference labels are separated in the confirmatory design. A favorable evaluator, threshold, or correction coefficient cannot be selected on the labels used for the headline inference.

### Research question 3 — reference uncertainty and shift

> How much apparent evaluator error is attributable to rater disagreement or ambiguous tasks, and when does evaluator utility fail under held-out task or site shift?

**H3 — heterogeneous utility and abstention.** Proxy utility and abstention will vary across observable task, site, visibility, and progress strata. Held-out task-family and site analyses are confirmatory only when the frame provides prespecified support; otherwise they remain secondary and explanatory.

## Preliminary evidence

### Human metric sensitivity

Across 28 RoboArena policy pairs and 3,879 matched sessions, changing from per-policy binary success to direct human preference moved `P(candidate better)` by 13.0 percentage points on average, with a 95% interval of 6.4 to 19.6 points, and changed seven of 28 threshold decisions. Both policies failed in 81.8% of sessions, making binary success largely non-discriminating. On the 586 sessions where exactly one policy succeeded, preference agreed with that policy in 583 cases and never preferred the failed policy. This is evidence that the evaluation metric—not merely evaluator identity—can materially alter a policy conclusion.

### Public VLM prediction study

The released-prediction analysis joins public per-view VLM outputs to matched RoboArena sessions using a stable video stem. Camera views are averaged inside a policy episode before candidate-minus-baseline differences are constructed. Twenty-four model runs retain all twenty eligible policy pairs; all 24 show at least one descriptive decision difference from the reference. The result establishes finite-benchmark, reference-relative policy distortion, not population prevalence.

Only five of 25 released runs have a median fixed-PPI variance ratio below one. This rejects a universal label-saving hypothesis. The strongest post-hoc example, RoboReward Qwen3-VL 8B, reduces reconstruction interval width and absolute error by approximately 14-15% across tested budgets while maintaining near-nominal repeated-sampling coverage. Gemini 2.5 Flash-Lite increases both by approximately 25%. This contrast motivates a thesis about evaluator suitability and statistical decision safety rather than a blanket claim that VLMs reduce annotation cost.

All preliminary analyses are exploratory because released test artifacts were inspected during method development. Their role is to establish feasibility, estimate effect scales, identify failure modes, and design an independent confirmation—not to stand in for that confirmation.

## Literature position and claimed contribution

RoboArena introduced distributed, double-blind real-robot policy comparisons and reports progress and preference because equal progress can conceal a clear preference [1]. RoboReward evaluates general-purpose VLM reward models at the episode level and releases the per-example predictions used here [2,3]. TrustRoboReward addresses consistency between pointwise scores and pairwise preferences [4]. Robometer and WFM-Eval study evaluator architectures and failure modes [5,6]. RobotArena Infinity studies scalable simulation-centered policy evaluation with automated and human judgments [7]. Eval-Actions adds fine-grained execution-quality labels and a multimodal robot evaluator [14].

Prediction-Powered Inference establishes valid inference using plentiful predictions and fewer labels [8], while PPI++ power-tunes the correction so weak predictions need not reduce precision [9]. Stratified PPI and active statistical inference address heterogeneous error and label allocation [10,11]. Prediction-Powered Ranking extends the framework to ranking [12], and Active Multiple-Prediction-Powered Inference studies adaptive routing among predictors and labels [15]. Most importantly, SureSim already applies PPI to robot-policy evaluation using simulation as the imperfect proxy for real outcomes [13]. PPI, active labeling, and model-assisted ranking are therefore infrastructure and adjacent work—not the novelty claim.

The surrounding field has moved further since the first proposal draft. Post-hoc regression improves auto-evaluation in the few-label regime and documents cases where adaptive PPI can be unstable [16]. Multiple-PPI and AM-PPI optimize allocation across several predictors [15,17]. Prediction-powered e-values extend the framework to anytime- and post-hoc-valid testing [18], and reliable algorithm selection uses held-out labeled data to validate model-guided selection [19]. This makes the novelty bar explicit: a held-out gate plus PPI is a conservative baseline, not a world-class thesis contribution by itself.

The bounded candidate contribution is:

> A two-stage, fail-safe certificate for simultaneous decisions over a graph of matched robot policies: audit a frozen VLM on labels separated from inference, use it only when prespecified utility and shift gates pass, otherwise return human-only inference, and validate the decisions against blinded multi-rater references.

The contribution is methodological and empirical. It does not claim to introduce VLM reward modeling, PPI, active sampling, robot-policy ranking, or the observation that progress and preference can differ. The targeted search found no prior work that jointly handles shared-session policy graphs, repeated views, separated evaluator gating, simultaneous decision uncertainty, blinded multi-rater references, and abstention under task/site shift for video-based robot evaluation. That is a proposal-level candidate gap, not proof of universal priority; every component has adjacent literature, and the final novelty claim requires a supervisor-led systematic review.

### Novelty decision and theorem target

The conservative split-sample certificate now exists in `src/policy-certificate.js` and is exercised by adversarial tests. Its branch-validity argument is intentionally simple: the audit data choose between two procedures frozen before the disjoint inference labels are observed. The implementation uses Bonferroni-normal finite-frame intervals and must not be described as the graph-aware theorem.

For a PhD, the headline contribution is the following research target:

> Selective proxy-assisted simultaneous inference for clustered policy-comparison graphs, using cross-fitted proxy selection and cluster influence vectors, with graph-wide coverage and a high-probability efficiency/no-harm bound relative to human-only inference under prespecified heterogeneous-error and shift conditions.

The target proof must state the sampling frame, cluster structure, boundedness or moment assumptions, proxy-selection sigma-field, number and growth of graph edges, and the exact guarantee. A multiplier-bootstrap max statistic is one candidate mechanism, not a requirement. If the guarantee cannot be established, the PhD claim narrows to the conservative procedure and empirical boundary result; the proposal will not relabel an engineering integration as new theory.

## Proposed research program

### Study 1 — exploratory policy-distortion atlas (completed)

The completed secondary analysis establishes the pipeline, data joins, units of analysis, candidate endpoints, and main failure modes across released evaluators. It will be reported transparently as exploratory and used only to design the confirmatory study.

Deliverables are a complete evaluator-by-policy distortion table, residual-variance diagnostics, parse-loss accounting, and a reproducible external artifact manifest. No model will be presented as prospectively selected on this dataset.

### Study 2 — fail-safe policy-decision certificate (core method)

The core method will compare four prespecified procedures: human-only inference, naive VLM substitution, fixed PPI, and the proposed two-stage certificate. The first executable baseline is already present: it enforces population membership, session-level audit/inference separation, all-edge support, deterministic bootstrap gating, fixed-PPI eligibility, exact human-branch identity after abstention, Bonferroni multiplicity, and four-way decisions. Before confirmatory labels are inspected, the protocol will freeze:

1. one open-weight evaluator and immutable checkpoint, prompt, preprocessing pipeline, and parser;
2. the policy graph, edge weights, practical-equivalence margin `delta`, and simultaneous 95% error target;
3. a held-out evaluator-audit subset and a separate policy-inference subset;
4. fixed PPI with `lambda = 1` when the evaluator gate passes, and the exact human-only fallback when it fails;
5. matched session as the sampling unit and within-episode aggregation for repeated camera views;
6. evaluator-utility, consistency, and shift-gate thresholds;
7. the human-review-time precision target `w* = delta / 2` and the minimum worthwhile cost ratio;
8. inclusion, parsing, missingness, adjudication, and stopping rules; and
9. simulation scenarios, random seeds, Monte Carlo tolerance, and multiplicity correction.

The core MASc/MSc method uses sample separation because it makes the gate auditable: labels used to decide whether the VLM is eligible are not reused for the headline inference. The conservative implementation is a feasibility artifact, not evidence that its normal approximation attains nominal coverage on the target frame. A PhD must attempt the cross-fitted, graph-aware validity/no-harm result above and validate it against the conservative baseline. That result is a research objective, not a guarantee already established by this proposal.

### Study 3 — multi-rater and shift validation

The admission-independent minimum track uses stable public RoboArena/RoboReward artifacts plus new, blinded ratings on a prespecified, previously unlabeled reference subset. At least three raters per selected episode will independently score observable execution progress, with randomized policy order and an allowed `indeterminate` response. The primary session reference is the mean of available blinded ratings after prespecified quality checks; agreement, rater effects, ambiguity, and adjudication sensitivity are reported rather than hidden. This track validates reference reliability and internal decision behavior but does not establish generalization to unseen robots or institutions.

The preferred external track is a small prospective laboratory frame containing new tasks, policies, sites, or robot conditions whose labels remain blinded until protocol lock. Subject to support, leave-one-task-family-out and leave-one-site-out stress tests will measure coverage, decision error, cost, and abstention. Sparse strata are pooled or reported descriptively. The thesis remains successful if the evaluator never passes the gate: a well-powered rejection identifies when automated evaluation should abstain.

## Data, estimand, and trust boundary

The analysis uses original RoboArena normalized metadata for policy, slot, task, and site; HELM RoboRewardBench instances and raw released predictions; and the benchmark's 1-5 human-verified reference scores. Raw datasets, videos, predictions, and full generated outputs remain outside Git. The repository stores code, schemas, retrieval instructions, checksums, derived summaries, and claim boundaries.

The independent observational unit is a matched robot-evaluation session. Multiple cameras are repeated measurements of one policy episode and are aggregated before constructing candidate-minus-baseline differences. Policies form a comparison graph with prespecified edges `e = 1, ..., E`. For session `i` on edge `e`, `Y_ie` is the mean blinded-rater candidate-minus-baseline score and `F_ie` is the corresponding VLM difference. The finite-frame edge effect is:

\[
\theta_e = \frac{1}{N_e}\sum_{i=1}^{N_e}Y_{ie}.
\]

For a labeled inference subset `L_e`, fixed PPI estimates each edge effect as:

\[
\widehat{\theta}_{e,PPI}
=
\overline{F}_{e,all}
+
\overline{(Y-F)}_{e,L_e}.
\]

The output is a simultaneous confidence set `C(theta)` over all prespecified edges. For edge interval `[L_e, U_e]` and practical-equivalence margin `delta`, the decision is `candidate superior` when `L_e > delta`, `baseline superior` when `U_e < -delta`, `practically equivalent` when `[L_e, U_e]` lies inside `[-delta, delta]`, and `unresolved` otherwise. A conservative simultaneous baseline uses prespecified edgewise intervals with family-wise correction; graph-aware max-statistic or cross-fitted alternatives must earn the headline claim through coverage verification.

Finite-population correction is applied to residual uncertainty. The audit gate is computed only from the held-out audit labels. If it rejects the evaluator, the certificate returns the frozen human-only procedure on the inference labels. If it accepts, it returns fixed PPI on those labels. This separation prevents favorable proxy selection on the same outcomes used for the confirmatory policy effects. It does not promise that every accepted realized interval is narrower.

A population-level claim about future tasks, sites, policies, or robots requires an explicit sampling frame beyond the released finite benchmark.

The benchmark references are not independent multi-rater gold labels. RoboReward reports a single verifier who could inspect the proposed label and rationale. Results are therefore reference-relative residuals and disagreements. Absolute evaluator error requires a separate blinded, multi-rater adjudication design.

## Statistical analysis and confirmation rules

### Primary distortion endpoint

The primary scientific endpoint is simultaneous 95% coverage of the policy-effect vector. The primary distortion endpoint is the maximum standardized automated-versus-reference effect discrepancy across prespecified edges. Wrong superiority declarations, equivalence changes, sign reversals, and rank-set differences are secondary. Exploratory comparisons across many models remain descriptive.

### Primary label-efficiency endpoint

The primary efficiency estimand is the ratio of human labels and measured review minutes required by the certificate versus human-only inference to reach maximum simultaneous half-width `w* = delta / 2`. The smallest worthwhile ratio is frozen from pilot time measurements and supervisor-approved decision consequences; `0.90` is a provisional design value, not a fact established by the exploratory benchmark.

A positive result requires all of the following:

- empirical simultaneous coverage consistent with the nominal 95% target under a prespecified tolerance and Monte Carlo uncertainty assessment;
- a cost ratio below the frozen smallest-worthwhile threshold when the evaluator gate accepts; and
- no increase in unsupported superiority declarations relative to the human-only procedure within the prespecified tolerance.

Mean absolute error, rank-set size, and abstention rate are supporting outcomes. High agreement caused by most comparisons returning `unresolved` is not treated as successful reconstruction. A rejected evaluator produces the valid result `no reliable automated saving`, not post-hoc model reselection.

### Power and sample size

Study size and the audit/inference split will be selected by simulation before confirmatory labels are opened. Simulations use development residuals or blinded design information and span informative, uninformative, biased, clustered, missing, and shifted proxies. They will estimate the sessions, raters, and review minutes needed for at least 80% power at the frozen cost threshold while verifying simultaneous coverage. If the available frame cannot meet the power or coverage gate, the study becomes estimation-focused and narrows its claim rather than manufacturing certainty.

### Missingness and parse failures

Every released prediction must be classified as joined, missing, or unparseable. Nothing is silently imputed in the primary analysis. A sensitivity analysis may use bounded worst-case values or a prespecified missingness model, but it cannot replace the complete-case primary result without an amendment written before outcome inspection.

## Ethics, data governance, and reproducibility

The current study is secondary analysis of public benchmark artifacts and recruits no new participants. Before any independent manual review, private video use, or new evaluator study, the researcher will obtain a written institutional determination about research-ethics review and data-use requirements. No claim of exemption is assumed across institutions.

Data minimization is enforced: the metadata-only workflow does not load or copy videos, public prediction analysis downloads no media, raw files remain outside Git, and a repository check fails on common raw-data extensions or files larger than 5 MiB. External manifests record source URLs, retrieval times, byte sizes, and SHA-256 hashes. Stochastic analyses use frozen seeds and deterministic joins.

Reproduction has two levels. Repository-level engineering reproduction runs without the external dataset and verifies parsers, matched comparisons, uncertainty propagation, fail-closed behavior, and research-package integrity. Full empirical reproduction additionally retrieves the public benchmark artifacts, verifies hashes, normalizes RoboArena metadata, and regenerates the dated result JSON. The lightweight summary in `results/` explicitly states that it is transcribed from the exploratory reports and is not a substitute for raw-artifact recomputation.

## Expected contributions

1. **Verified baseline artifact:** an executable, deterministic split-sample certificate that fails closed on leakage, missing graph support, and harmful proxies and returns the identical frozen human-only branch after abstention.
2. **A simultaneous policy-decision target:** superiority, practical equivalence, and unresolved outcomes over a shared-session policy graph rather than isolated episode scores.
3. **A reference-aware validation protocol:** blinded multi-rater judgments, retained ambiguity, session-level clustering, repeated-view aggregation, and explicit reference-relative claims.
4. **A decision-centered cost outcome:** labels and measured human-review minutes required to reach a prespecified simultaneous precision target.
5. **A falsifiable abstention result:** evaluator rejection is a publishable boundary condition, not a hidden failure followed by post-hoc model selection.
6. **Conditional PhD contribution:** a cross-fitted graph-aware coverage/no-harm guarantee that must be proved and externally validated before it is claimed.

## Limitations and risks

- **Benchmark reuse:** current results informed method selection. New multi-rater labels on reused public episodes can validate reference reliability and internal behavior, but only a new sampling frame can support external confirmation.
- **Reference validity:** raters may share rubric biases and disagreement may be structured. The primary reference retains rater uncertainty and does not claim objective task success.
- **External validity:** the released frame does not establish generalization to unseen robots, tasks, or institutions.
- **Dependence and multiplicity:** policy edges share policies and may share sessions. A conservative simultaneous baseline is required before a graph-aware improvement can carry the claim.
- **Gate validity:** reusing gate labels for inference can invalidate simple guarantees. The core design separates them; cross-fitting remains an extension until verified.
- **Practical significance:** `delta`, `w*`, and the cost threshold require development-only elicitation and timing evidence before they are frozen.
- **Data availability:** the public-data minimum track avoids dependence on a future release, but new ratings still require budget, licensing, and ethics/data-use determinations.

## Work plan and stopping rules

| Phase | Target window | Observable output | Decision gate |
|---|---|---|---|
| Protocol and simulation | Months 1-2 | Frozen policy graph, `delta`, simultaneous target, gate, cost endpoint, simulation suite, ethics/data determination | Stop or narrow if coverage cannot be recovered under weak, biased, clustered, and shifted proxies |
| Multi-rater pilot | Months 3-4 | Blinded protocol, rater-time measurements, agreement analysis, frozen audit/inference split | Stop or redesign if rating reliability, cost, licensing, or support is inadequate |
| Core certificate study | Months 5-7 | Locked human-only, naive VLM, fixed-PPI, and fail-safe certificate comparison | Accept savings only when coverage, cost, and unsupported-declaration gates all pass |
| Shift / external validation | Months 8-9 | Held-out task/site results or a prospective laboratory replication | Label reused-frame results internal; pool or describe sparse strata |
| Thesis and release package | Months 10-12 | Thesis chapters, reproducibility bundle, defense materials, archived protocol | Release only after claim, license, privacy, accessibility, and artifact review |

The thesis remains valuable if label savings fail: a well-powered rejection identifies when automated evaluation is unsuitable and quantifies the human evidence required instead. Stop and escalate rather than guess if the sampling frame changes the estimand, a security or data-use boundary is ambiguous, a required ethics determination is missing, the practical margin lacks a defensible basis, or simultaneous coverage cannot be enforced.

## Scope

The **MASc/MSc core** includes the completed audit, the executable separated certificate, simulation-based coverage verification, and internal multi-rater validation on a secured public frame. The **PhD core—not merely an optional flourish—**must add a new cross-fitted graph-aware validity/no-harm result and validation in more than one sampling frame. If that research risk is inappropriate for the degree or cannot be supported, the honest scope is the MASc/MSc thesis. Both exclude robot control, foundation-model training, a broad new robot benchmark, physical safety certification, causal policy claims, private-data use without authorization, and paid inference or new manual labeling without an approved protocol and budget.

## References

1. Atreya, P., et al. “RoboArena: Distributed Real-World Evaluation of Generalist Robot Policies.” arXiv:2506.18123, 2025. <https://arxiv.org/abs/2506.18123>
2. Lee, T., et al. “RoboReward: General-Purpose Vision-Language Reward Models for Robotics.” arXiv:2601.00675, 2026. <https://arxiv.org/abs/2601.00675>
3. Stanford CRFM. “HELM RoboReward Benchmark.” 2026. <https://crfm.stanford.edu/helm/robo-reward-bench/>
4. Wang, Y., et al. “TrustRoboReward: Preference-Ordered Isotonic Score Editing for Multi-Paradigm Robot Reward Models.” arXiv:2608.08491, 2026. <https://arxiv.org/abs/2608.08491>
5. “Robometer: Scaling General-Purpose Robotic Reward Models.” Project page, 2026. <https://robometer.github.io/>
6. Khose, S., et al. “WFM-Eval.” Project page, 2026. <https://sahilkhose.github.io/wfm-eval-cvpr26/>
7. Jangir, Y., et al. “RobotArena Infinity: Scalable Robot Benchmarking via Real-to-Sim Translation.” arXiv:2510.23571, 2025. <https://arxiv.org/abs/2510.23571>
8. Angelopoulos, A. N., Bates, S., Fannjiang, C., Jordan, M. I., and Zrnic, T. “Prediction-Powered Inference.” Science, 2023. <https://arxiv.org/abs/2301.09633>
9. Angelopoulos, A. N., et al. “PPI++: Efficient Prediction-Powered Inference.” arXiv:2311.01453, 2023. <https://arxiv.org/abs/2311.01453>
10. Fisch, A., et al. “Stratified Prediction-Powered Inference.” arXiv:2406.04291, 2024. <https://arxiv.org/abs/2406.04291>
11. Zrnic, T., and Candès, E. “Active Statistical Inference.” ICML, 2024. <https://proceedings.mlr.press/v235/zrnic24a.html>
12. “Prediction-Powered Ranking of Large Language Models.” arXiv:2402.17826, 2024. <https://arxiv.org/abs/2402.17826>
13. Badithela, A., et al. “Reliable and Scalable Robot Policy Evaluation with Imperfect Simulators.” arXiv:2510.04354, 2025. <https://arxiv.org/abs/2510.04354>
14. Liu, M., et al. “Eval-Actions: Fine-Grained Execution Quality Evaluation for Robotic Manipulation.” arXiv:2601.18723, 2026. <https://arxiv.org/abs/2601.18723>
15. Brawand, N., et al. “Active Multiple-Prediction-Powered Inference.” arXiv:2605.08429, 2026. <https://arxiv.org/abs/2605.08429>
16. Eyre, B., and Madras, D. “Regression for the Mean: Auto-Evaluation and Inference with Few Labels through Post-hoc Regression.” ICML, 2025. <https://proceedings.mlr.press/v267/eyre25a.html>
17. Cowen-Breen, C., et al. “Multiple-Prediction-Powered Inference.” arXiv:2603.27414, 2026. <https://arxiv.org/abs/2603.27414>
18. Csillag, D., Struchiner, C. J., and Goedert, G. T. “Prediction-Powered E-Values.” ICML, 2025. <https://proceedings.mlr.press/v267/csillag25a.html>
19. Fannjiang, C., and Park, J. W. “Reliable Algorithm Selection for Machine Learning-Guided Design.” ICML, 2025. <https://proceedings.mlr.press/v267/fannjiang25a.html>

Literature search last updated 2026-08-24. This is a targeted novelty audit, not a formal systematic review.
