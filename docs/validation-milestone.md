# Validation milestone: bias-aware pairwise robot evaluation

> **Status amendment, 2026-08-13:** the original engineering milestone is complete. Its premise that new model inference was required has been superseded for the general machine-judge question by released RoboRewardBench per-item predictions. See [public-prediction-ppi-findings.md](public-prediction-ppi-findings.md) and [ADR-0002](adr-0002-public-predictions-and-ppi.md). The frozen binary/eight-frame prompt still requires a separate run if that exact contract remains an objective.

## Scope and maturity

**Validate.** Build the smallest engine capable of testing whether calibration changes close RoboArena-style policy decisions and whether sequential evidence planning can reduce human labels or physical trials. The milestone stops at offline analysis and CLI recommendations. It does not include robot control, hardware monitoring, certification, deployment enforcement, dashboards, or hosted services.

The public `RoboArena/DataDump_07-17-2026` snapshot is an MIT-licensed, 21.7 GB source with 3,883 matched evaluation sessions and 10,783 policy episodes. Its published metadata provides human preference and task-success outcomes, but no automatic-judge field. Therefore RoboArena can validate the comparison/planning baseline; judge calibration additionally requires separately generated or supplied paired machine/human labels.

## Outcome and definition of done

A successful milestone lets a researcher:

1. normalize RoboArena metadata without reading or copying media payloads;
2. compare two policies only on matched sessions and see effect size, a 95% credible interval, and `P(candidate > baseline)`;
3. receive a deterministic STOP/TEST decision and bounded next-evidence recommendation;
4. audit false-positive and false-negative rates by supported metadata dimensions;
5. request calibration only when adequate paired evidence exists, with an explicit failure otherwise; and
6. prove that raw dataset payloads are excluded from the repository.

Engineering completion requires all automated tests and the data-boundary check to pass. Product success remains unproven until the preregistered experiments are run on real paired judge/human evidence.

## Non-negotiable invariants

- Raw datasets, videos, arrays, and generated evidence are not committed to Git.
- Input files are read-only; importing never modifies the source dataset.
- Missing automatic-judge evidence is reported, never inferred from human success or preference.
- Comparisons are matched by `comparison_id`; unmatched trials cannot masquerade as task/site-adjusted evidence.
- Results are deterministic for the same bytes, options, and seed.
- Calibration uncertainty is propagated; an estimated correction is not presented as ground truth.
- The tool makes no safety, certification, causal, or future-performance guarantee.

## Success measures and preregistered decision

On a frozen real paired-label evaluation set, report:

- judge false-positive/false-negative rates by policy, task grouping, and site, including denominators;
- the rate at which naive and calibrated decisions differ for close comparisons;
- agreement of calibrated conclusions using 2%, 5%, 10%, 20%, and 50% of human labels with the conclusion from 100%; and
- evidence used to reach the same decision under fixed-count and sequential policies.

Before analysis, freeze the exact comparison set, confidence threshold, practical-effect threshold, random seeds, task taxonomy, label-subsampling protocol, and cost model.

- **Kill:** calibration barely changes estimates and almost never changes a close decision.
- **Thesis only:** bias is meaningful, but calibration/planning does not materially reduce evidence cost.
- **Push:** calibration changes a meaningful fraction of close decisions and reaches the same reliable conclusions with substantially fewer robot trials or human labels.

Numeric thresholds for “barely,” “meaningful,” and “substantially” still require an explicit product/research-owner decision before confirmatory analysis; the CLI must not invent them.

## Authority and stop conditions

Routine local implementation, tests, fixtures, deterministic modeling choices, and narrow refactors are autonomous. Human approval is required for downloading the full 21.7 GB payload, using credentials, incurring material compute/API cost, publishing results, changing the evidence contract, or turning advisory output into an enforced deployment gate.

Stop and escalate if the source schema changes incompatibly, automatic-judge semantics are ambiguous, a task taxonomy or evidence cost cannot be established, a frozen protocol must be changed after results are observed, or matched evidence is insufficient for the requested comparison.

## Release and learning

This milestone is local and unreleased. After the offline protocol passes, review effect sizes and evidence savings before choosing to extend, revise, or retire it. Any production use needs an ADR covering the calibration model, trust boundary, decision threshold, provenance, rollback, and monitoring.
