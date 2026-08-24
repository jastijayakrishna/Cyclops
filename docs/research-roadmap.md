# Research roadmap and decision gates

## Outcome

Produce a defensible thesis that determines when automated video judgments can reduce human review for simultaneous robot-policy decisions, abstains to human-only inference when they cannot, and reports reference uncertainty instead of assuming one verifier is ground truth.

## Twelve-month work plan

| Phase | Months | Evidence produced | Exit criterion |
|---|---:|---|---|
| Protocol and simulation | 1-2 | Frozen policy graph, practical margin `delta`, simultaneous error target, evaluator gate, review-time endpoint, ethics/data determination, adversarial simulation suite | Nominal coverage is recovered for weak, biased, clustered, missing, and shifted proxies |
| Multi-rater pilot | 3-4 | Blinded rubric, randomized tasks, rater-time measurements, agreement and ambiguity analysis, frozen audit/inference split | Reliability, licensing, cost, and matched-session support meet preregistered minimums |
| Core certificate study | 5-7 | Human-only, naive VLM, fixed-PPI, and fail-safe certificate results | Savings are accepted only when coverage, cost, and unsupported-declaration gates all pass |
| Shift and external validation | 8-9 | Leave-task/site-out stress tests and, if available, a prospective lab replication | Reused-frame evidence remains labelled internal; sparse strata are pooled or descriptive |
| Thesis and release | 10-12 | Thesis chapters, artifact index, defense deck, archived protocol and software revision | Claim, privacy, license, accessibility, reproducibility, and committee reviews pass |

## Primary confirmation contract

- One open-weight evaluator, checkpoint hash, prompt, preprocessing pipeline, and parser are frozen.
- Policies form a prespecified comparison graph; matched session is the sampling unit and camera views are aggregated inside episodes.
- Every edge receives a simultaneous 95% confidence interval for the multi-rater candidate-minus-baseline effect.
- With practical margin `delta`, decisions are superior, inferior, practically equivalent, or unresolved according to interval position.
- Gate labels are separated from inference labels. A rejected evaluator returns the exact human-only procedure.
- Fixed PPI with `lambda = 1` is the core augmented procedure after gate acceptance.
- The primary efficiency outcome is labels and measured human-review minutes required to reach maximum simultaneous half-width `w* = delta / 2`.
- A positive result requires nominal simultaneous coverage, a frozen worthwhile cost ratio, and no excess unsupported superiority declarations.
- A failed gate produces `no reliable automated saving`; it never triggers evaluator reselection on the same labels.
- The conservative `roboeval certify` baseline remains reproducible, deterministic, and fail-closed under leakage, missing-edge, weak-proxy, biased-proxy, and shifted-proxy fixtures.

## Degree-level novelty gate

- **MASc/MSc:** the conservative split-sample method plus a locked multi-rater validation can carry the thesis if the experiment is powered and the practical margin is defensible.
- **PhD:** the thesis must establish a new cross-fitted graph-aware simultaneous coverage/no-harm guarantee or an equally deep methodological result. “PPI plus a gate” is a baseline, not the doctoral novelty claim.
- Stop or re-scope if a systematic review shows that the claimed guarantee already exists.

## Two-track evidence plan

### Guaranteed internal-validation track

Use stable public RoboArena/RoboReward artifacts plus new blinded multi-rater judgments on a prespecified reference subset, subject to licensing, budget, and ethics/data-use determination. This can validate reference reliability and internal certificate behavior without waiting for a future benchmark release. It cannot establish generalization to unseen robots or institutions.

### Preferred external-validation track

Use a prospective laboratory frame containing new tasks, policies, sites, or robot conditions, kept blinded until protocol lock. This track carries any external-confirmation claim.

## Degree boundary

- **MASc/MSc core:** completed audit, executable separated certificate, simulation coverage verification, and internal multi-rater validation.
- **PhD core:** a proved cross-fitted graph-aware simultaneous validity/no-harm result plus validation in more than one sampling frame.

## Escalation conditions

Stop and request a supervisor decision if the sampling frame changes the estimand; `delta` lacks a defensible operational basis; benchmark licensing, rater compensation, or ethics are ambiguous; matched support is insufficient; cross-edge dependence cannot be represented; or the proposed simultaneous procedure fails its coverage invariant.
