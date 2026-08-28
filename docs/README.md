# Documentation map

This directory separates current evidence, executable method contracts, research design, and historical development. The shortest reading path is:

1. [Research summary](research-summary.md)
2. [Public prediction and PPI findings](public-prediction-ppi-findings.md)
3. [Fail-safe certificate ADR](adr-0003-fail-safe-policy-certificate.md)
4. [Reproducibility contract](reproducibility.md)
5. [Research-readiness review](research-readiness-review.md)

## Research overview

- [Research summary](research-summary.md) — question, evidence, method, validation plan, and degree boundary.
- [Thesis proposal](thesis-proposal.md) — hypotheses, state of the art, estimand, protocol, ethics, limitations, and twelve-month plan.
- [Research brief](research-brief.docx) — formatted two-page summary.
- [Thesis overview](thesis-overview.pptx) — concise presentation deck.
- [Methodology questions](methodology-questions.md) — direct answers about novelty, validity, estimands, and inference boundaries.

## Empirical evidence

- [Public prediction and PPI findings](public-prediction-ppi-findings.md) — policy distortion and label-efficiency study using released RoboRewardBench predictions.
- [Human metric agreement findings](metric-agreement-findings.md) — how binary success and direct preference alter matched policy decisions.
- [Pilot findings](pilot-findings.md) — frozen local manual-review pilot and its limitations.
- [Initial findings](initial-findings.md) — first matched-policy analysis retained as historical evidence.
- [Local judge feasibility](local-judge-feasibility.md) — consumer-hardware vision-model pilot and observed limitations.

The canonical lightweight evidence index is [`results/exploratory-summary.json`](../results/exploratory-summary.json). It records the status and boundary of every headline result.

## Executable method and contracts

- [Certificate input and claim boundary](certificate-input.md) — runnable input format, verified properties, and explicit non-guarantees.
- [Reproducibility contract](reproducibility.md) — repository checks and full empirical reproduction.
- [Validation milestone](validation-milestone.md) — completed engineering outcome and original validation boundary.

## Architecture decisions

- [ADR-0001: Validation model and external data boundary](adr-0001-validation-model-and-data-boundary.md)
- [ADR-0002: Public VLM predictions and PPI](adr-0002-public-predictions-and-ppi.md)
- [ADR-0003: Separated evaluator gating and inference](adr-0003-fail-safe-policy-certificate.md)

## Research limits and next evidence

- [Research-readiness review](research-readiness-review.md) — critical assessment of novelty, validity, and unresolved thesis risk.
- [Literature and novelty review](literature-review.md) — closest related work and the defensible contribution boundary.
- [Research roadmap](research-roadmap.md) — two-track validation plan and decision gates.

## Evidence hierarchy

The documents use four distinct evidence levels:

1. **Executable behavior:** properties demonstrated by code and automated tests.
2. **Exploratory empirical evidence:** observed results used to establish feasibility and design confirmation.
3. **Confirmatory objectives:** claims requiring a frozen protocol and independent labels or sampling frame.
4. **Proposed theory:** graph-aware or cross-fitted guarantees that remain research objectives until proved and verified.

These levels must not be collapsed. In particular, working software does not prove a statistical coverage theorem, and exploratory benchmark results do not establish external generalization.
