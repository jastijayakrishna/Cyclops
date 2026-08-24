# Research-readiness review

**Review scope:** methodological novelty, empirical validity, implementation evidence, and remaining thesis risk  
**Review date:** 2026-08-24

## Current assessment

The project is a serious validation-stage research program rather than a completed result. It begins from a measurable failure mode: episode-level evaluator accuracy does not determine whether matched policy comparisons remain superior, equivalent, or unresolved. The repository contains exploratory evidence for that failure and an executable conservative certificate that can reject weak proxy evidence.

The main scientific risk is incrementalism. Prediction-powered inference, active label allocation, multiple-predictor routing, post-hoc regression, ranking, and robot-policy PPI already occupy adjacent territory. A held-out gate plus fixed PPI is therefore treated as an auditable baseline. The stronger methodological target is selective proxy-assisted simultaneous inference over a clustered policy graph, with cross-fitted selection and a formal coverage/no-harm result.

## Evidence already established

- Matched sessions, rather than individual camera views, are the unit of policy comparison.
- Exploratory analyses separate human preference, binary success, and released VLM progress predictions.
- Public benchmark artifacts are joined with explicit provenance and without committing raw datasets.
- The implementation fails closed when paired labels, policy edges, or audit/inference separation are insufficient.
- The conservative certificate is executable and covered by deterministic adversarial tests.

## Unresolved methodological risks

- **Novelty:** the graph, clustering, selection, or reference-uncertainty structure must yield a distinct guarantee or a scientifically meaningful boundary result.
- **Confirmation:** the new-label frame, rater budget, ethics/data determination, practical-equivalence margin, and prospective validation frame remain to be finalized.
- **Validity:** Bonferroni-normal intervals are a transparent baseline, not the proposed solution for clustered shared-session graphs or cross-fitted selection.
- **Robotics relevance:** evidence limited to reused public episodes supports finite-frame internal validity, not generalization to new robots, institutions, or deployment conditions.
- **Reference uncertainty:** multi-rater disagreement and ambiguity may require a revised estimand rather than a single assumed ground-truth label.

## Executable conservative baseline

The current certificate enforces:

1. a frozen proxy population and prespecified policy graph;
2. session-disjoint evaluator-audit and policy-inference labels;
3. edgewise support, residual-variance, residual-bias, and supported-shift checks;
4. fixed-lambda PPI only when every prespecified edge passes;
5. the identical human-only branch when any gate fails;
6. Bonferroni simultaneous intervals with superiority, equivalence, and unresolved decisions; and
7. deterministic tests for helpful proxies, harmful proxies, leakage, multiplicity, shift, and missing edges.

This establishes software feasibility and a falsifiable baseline. It does not establish the proposed graph-aware theorem, finite-sample optimality, physical safety, or external validity.

## Thesis contribution boundary

### Empirical validation contribution

> Determine, on a locked multi-rater robot-evaluation frame, when a separated proxy-assisted certificate reduces measured human review while preserving simultaneous policy-decision error control, and characterize the conditions that force abstention.

This contribution requires an adequately powered design, an operationally justified practical margin, locked analysis rules, and publication of negative label-saving results.

### Methodological extension

> Develop selective proxy-assisted simultaneous inference for clustered policy-comparison graphs, with cross-fitted proxy selection and a formal coverage/no-harm guarantee under heterogeneous proxy error, then test that guarantee in more than one robot-evaluation frame.

The intended result must state the assumptions under which cross-fitted selection preserves graph-wide coverage, accepted automation is bounded relative to human-only inference, and weak or shifted proxies cause abstention rather than unsupported declarations.

## Falsification map

| Risk | Evidence that defeats the claim | Required response |
|---|---|---|
| No methodological gap | Existing work proves the same graph-aware selective guarantee | Narrow the claim to empirical robot-evaluation validation or identify a different gap |
| No label saving | The gate rarely accepts or accepted intervals are not cheaper at target precision | Report the boundary condition; do not change evaluators post hoc |
| Unstable reference | Agreement is low or rater/task effects dominate | Model reference uncertainty, revise the estimand, or avoid absolute-error language |
| Coverage failure | Adversarial simulation or held-out replication misses the target beyond tolerance | Retain the conservative fallback and narrow the theoretical claim |
| No external frame | Only reused public episodes are available | Limit conclusions to finite-frame internal validity |
| Arbitrary practical margin | `delta` cannot be tied to observable consequences | Report estimation intervals without superiority/equivalence declarations |

## Next evidence gates

1. Freeze the graph, practical margin, error target, sampling frame, and rater protocol.
2. Verify coverage and abstention under clustered, heterogeneous, and adversarial proxy simulations.
3. Collect blinded multi-rater labels and measure reference reliability and review time.
4. Run the locked human-only and proxy-assisted comparison without changing gates post hoc.
5. Separate internal finite-frame conclusions from claims supported by any prospective external frame.

## Sources

- Badithela et al., “Reliable and Scalable Robot Policy Evaluation with Imperfect Simulators” (SureSim, 2025): <https://arxiv.org/abs/2510.04354>
- Eyre and Madras, “Regression for the Mean” (ICML 2025): <https://proceedings.mlr.press/v267/eyre25a.html>
- Cowen-Breen et al., “Multiple-Prediction-Powered Inference” (2026): <https://arxiv.org/abs/2603.27414>
- Brawand et al., “Active Multiple-Prediction-Powered Inference” (2026): <https://arxiv.org/abs/2605.08429>
- Zrnic and Candès, “Active Statistical Inference” (ICML 2024): <https://proceedings.mlr.press/v235/zrnic24a.html>
