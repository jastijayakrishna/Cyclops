# ADR-0003: Separate evaluator gating from simultaneous policy inference

**Status:** Accepted for the executable conservative baseline; graph-aware extension remains proposed  
**Date:** 2026-08-24

## Context

The exploratory benchmark analysis inspected released evaluator outcomes and found that only five of 25 model runs improved the median fixed-PPI residual-variance criterion. Selecting the best evaluator, correction, or threshold on the same scarce human labels used for policy inference would make a simple confirmatory coverage claim unreliable. Policy comparisons also form a graph: edges share policies and may share matched sessions, while camera views repeat measurements within episodes.

The benchmark reference is not independent multi-rater ground truth. A decision protocol must therefore distinguish automated evidence, human-reference uncertainty, and the sampling frame.

## Decision

The core thesis method will use a two-stage certificate:

1. Freeze one open-weight evaluator, checkpoint, prompt, preprocessing pipeline, parser, policy graph, practical margin, and simultaneous error target.
2. Allocate human labels to a held-out evaluator-audit subset and a separate policy-inference subset.
3. Compute utility, consistency, and shift gates only from the audit subset.
4. If every gate passes, use frozen fixed PPI with `lambda = 1` on the inference subset.
5. If any gate fails, return the exact frozen human-only inference procedure.
6. Produce simultaneous intervals across prespecified policy edges; do not treat edge decisions as independent.
7. Validate against blinded multi-rater session references and report agreement, ambiguity, and abstention.

## Guarantees intended

- Evaluator eligibility is not selected on the labels used for headline policy inference.
- Gate rejection cannot silently widen authority: it returns human-only inference.
- Repeated camera views are not counted as independent robot trials.
- Weak, missing, inconsistent, or shifted automated evidence can trigger abstention.
- Savings require coverage, cost, and unsupported-declaration gates to pass.

## Guarantees not provided

- Acceptance does not guarantee a narrower interval in every realized sample.
- The method does not certify robot physical safety or deployment readiness.
- Internal validation on reused public episodes does not establish external generalization.
- A cross-fitted or graph-aware improvement has no theorem or headline status until its simultaneous coverage is verified.
- Multi-rater agreement does not create objective ground truth.

## Alternatives considered

### Always use fixed PPI

Rejected because weak evaluators can increase residual variance and human-label requirements.

### Select the best evaluator on all revealed labels

Rejected because selection and inference use the same outcomes, encouraging optimistic precision and unstable model choice.

### Adaptive PPI as the primary method

Deferred. Cross-fitting may recover efficiency, but its graph-level simultaneous validity must be established before it carries the claim.

### Wait for a new external benchmark

Rejected as the sole plan because it makes thesis feasibility depend on an uncontrolled future release. A public-data, new-multi-rater minimum track is retained, with prospective lab data as the preferred external extension.

## Consequences

Sample separation sacrifices some label efficiency, so the core method is conservative but auditable. Power simulation must allocate labels between audit and inference. The proposal can proceed without a future benchmark release, but any result on reused episodes remains internal validation. “PPI plus a gate” is not treated as sufficient PhD novelty; the doctoral core must establish a cross-fitted graph-aware simultaneous validity/no-harm result or an equally deep contribution.

## Implementation evidence

`src/policy-certificate.js` implements the conservative split-sample branch logic, population and leakage guards, deterministic residual-variance/bias gate, fixed-PPI or human-only selection, Bonferroni-normal intervals, and four-way decisions. `test/policy-certificate.test.js` verifies helpful-proxy acceptance, harmful-proxy abstention with exact human-branch identity, multiplicity, determinism, session leakage rejection, and missing-edge rejection. This implementation demonstrates feasibility; it does not upgrade the normal approximation into a finite-sample graph theorem.
