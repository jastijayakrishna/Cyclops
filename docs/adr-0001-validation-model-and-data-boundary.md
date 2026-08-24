# ADR-0001: Validation model and external data boundary

- **Status:** Accepted for the validation milestone only
- **Date:** 2026-08-11

## Decision

Keep all source and normalized evidence outside the project repository. Fetch only RoboArena YAML for the first milestone, with Git LFS media transfer disabled, and remove transport-level Git metadata after verifying the publisher-declared session count.

Compare policies only in shared `comparison_id` sessions. For binary human outcomes, use a Jeffreys-prior Dirichlet posterior over the four paired outcomes. When paired automatic/human labels are supplied, estimate `P(human success | automatic verdict)` per policy and automatic verdict class, propagate that calibration uncertainty by deterministic Monte Carlo, use direct human outcomes where available, and fail closed when support is inadequate.

Evidence planning remains advisory and explicitly heuristic until a task taxonomy and cost model are frozen.

## Alternatives considered

- **Independent policy proportions:** simpler, but discards the matched task/site design and can overstate what was adjusted.
- **A full hierarchical task/site/evaluator model now:** potentially stronger, but the free-form task taxonomy and calibration evidence are not yet defined; choosing it before the validation protocol would manufacture precision.
- **Download all media immediately:** unnecessary for metadata comparisons and creates avoidable storage, Windows-path, and Git-inclusion risk.
- **Treat human success as an automatic judge proxy:** rejected because it makes the central bias question circular and unidentifiable.

## Guarantees and limits

The design guarantees deterministic outputs for a fixed seed, matched comparisons, explicit provenance, no silent calibration fallback, and an enforceable project data-size/extension check. It does not guarantee causal policy effects, optimal evidence allocation, judge generalization, runtime robot safety, certification suitability, or future policy performance.

Revisit this ADR before production use, after a paired judge/human dataset, task taxonomy, and evidence-cost model exist.

