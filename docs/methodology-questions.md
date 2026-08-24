# Methodology questions and concise answers

## What is actually novel?

Not VLM rewards, PPI, active labeling, ranking, multiple-predictor routing, post-hoc regression, or a held-out gate by themselves. The conservative split-sample certificate is the verified baseline. For an MASc/MSc, the contribution is the locked multi-rater, decision-level validation and boundary result. For a PhD, the candidate novelty is a cross-fitted graph-aware simultaneous coverage/no-harm guarantee under clustered heterogeneous proxy error. The targeted search supports this as a proposal-level gap, not proof of universal priority.

## Is the proposed certificate already implemented?

The conservative baseline is. `roboeval certify` enforces a frozen proxy population, session-disjoint audit and inference labels, all-edge support, deterministic utility/bias gating, fixed PPI eligibility, exact identity with the frozen human-only branch after abstention, Bonferroni multiplicity, and four-way decisions. Its normal approximation is not the proposed graph-aware theorem.

## Isn’t this just SureSim with a VLM proxy?

SureSim establishes that PPI can combine simulation and real trials. This thesis studies a different measurement problem: VLM video judgments can be inconsistent across point/pair paradigms, cameras, tasks, and human references. The new research question is when those judgments may enter a simultaneous policy decision—and how to abstain before an unsupported declaration.

## Why is episode-level MAE insufficient?

Policy effects are matched differences aggregated over sessions. Structured errors can cancel for one edge and amplify for another, so two evaluators with similar episode MAE can have different superiority, equivalence, and ranking consequences.

## What is the primary estimand?

For each prespecified policy edge `e`, `theta_e` is the finite-frame mean candidate-minus-baseline score after averaging blinded rater judgments within matched sessions. The primary output is a simultaneous 95% confidence set for the complete effect vector.

## What decision does the confidence set support?

For interval `[L_e, U_e]` and practical-equivalence margin `delta`: candidate superior if `L_e > delta`; baseline superior if `U_e < -delta`; practically equivalent if the interval lies inside `[-delta, delta]`; unresolved otherwise.

## Why is the evaluator gate separated from inference?

Selecting an evaluator on the same scarce labels used for inference can invalidate a simple coverage claim. The core design uses a held-out audit subset for utility, consistency, and shift gates, then applies either frozen fixed PPI or the exact human-only fallback on separate inference labels.

## Does “fail-safe” mean the accepted VLM can never make an interval worse?

No. The enforceable guarantee is structural: rejection returns the human-only procedure and selection is separated from inference. Accepted PPI must still earn its coverage and cost claim through simulation and confirmation; a narrower interval is not guaranteed in every realized sample.

## Why fixed PPI rather than an adaptive coefficient?

Fixed `lambda = 1` is auditable after a separated gate and avoids tuning on the inference labels. A cross-fitted adaptive or graph-aware method is a PhD-level extension until it demonstrates simultaneous validity.

## Why is “PPI plus a gate” not enough for a PhD?

SureSim already brings PPI to robot-policy evaluation, while PPI++, post-hoc regression, MultiPPI, AM-PPI, active inference, ranking, and prediction-powered e-values cover nearby efficiency and selection problems. The doctoral question must therefore be the unproved interaction among clustered policy graphs, selective proxy use, simultaneous decisions, and reference uncertainty—not the existence of a gate.

## Are the human references ground truth?

No. At least three blinded raters score observable execution progress, may return `indeterminate`, and are averaged only after prespecified quality checks. Agreement, rater effects, and ambiguity remain reported. The claim is reference-relative unless an independent physical outcome exists.

## How are camera views and shared policy pairs handled?

Views are repeated measurements inside one episode and are aggregated before session differences are constructed. Sessions are the sampling unit. Policy edges are not treated as independent; the primary output uses simultaneous inference across the prespecified graph.

## What replaces the arbitrary 10% interval-width target?

The endpoint is measured human-review labels and minutes needed to reach maximum simultaneous half-width `w* = delta / 2`. The smallest worthwhile cost ratio is frozen from development-only timing evidence and decision consequences; `0.90` remains provisional until then.

## How can the thesis proceed without a future benchmark release?

The minimum track uses stable public episodes plus new blinded multi-rater judgments on a prespecified subset, subject to licensing, budget, and ethics/data-use approval. This supports internal validation. A prospective lab frame is the preferred external-validation track.

## What happens if the VLM is bad everywhere?

The gate rejects it and the thesis reports no reliable automated saving, the conditions that caused abstention, and the human evidence required instead. That is a falsifiable, operationally useful negative result.

## Is this a safety certificate for robot behavior?

No. It is an evaluation-decision certificate under stated sampling and reference assumptions. It does not certify physical safety, deployment readiness, or causal policy superiority.

## Is the scope credible for an MASc/MSc?

Yes if bounded to the completed audit, separated certificate, simulation coverage verification, and internal multi-rater validation. For a PhD, a new cross-fitted graph-aware simultaneous-validity/no-harm result is the core contribution, while multi-frame external validation is the preferred empirical confirmation.

## Which design decisions remain open?

The unresolved decisions are the operational basis for `delta`, the acceptable simultaneous error target, rater protocol and ethics, and which prospective evaluation frame can support an external-validity claim.
