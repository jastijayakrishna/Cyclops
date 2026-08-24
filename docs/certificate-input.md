# Conservative policy-certificate input and claim boundary

The command below executes the verified baseline described in the thesis proposal:

```powershell
node bin/roboeval.js certify --input C:\absolute\path\to\certificate-frame.json
```

A zero-download synthetic demonstration exercises both branches:

```powershell
npm.cmd run demo:certificate
```

The helpful proxy must enter the fixed-PPI branch. The harmful proxy must abstain, and every returned estimate and interval must report `exact_human_fallback: true`.

The JSON object contains:

- `populationRows`: every frozen proxy observation in the finite frame;
- `auditRows`: human labels used only to determine proxy eligibility;
- `inferenceRows`: separate human labels used only for policy-effect inference;
- `alpha`: graph-wide error target, normally `0.05`;
- `delta`: practical-equivalence margin; and
- `gate`: frozen minimum support, residual-variance, bias, bootstrap, confidence, and seed settings.

Each population row has `edge`, `session_id`, and finite numeric `proxy`. Labeled rows add finite numeric `human`. Audit and inference rows must be session-disjoint, even when a session could contribute to different policy edges. Every labeled row must belong to the frozen population, and every prespecified edge must have inference support.

The baseline uses fixed `lambda = 1` PPI only if every edge passes the audit gate. Otherwise it produces the same human-only estimate and interval that the frozen human-only branch would have produced. It uses a two-sided Bonferroni-normal critical value across edges and returns candidate-superior, baseline-superior, practically-equivalent, or unresolved.

## What this implementation proves

- The proposal's conservative branch logic is executable.
- Audit/inference leakage and missing edges fail closed.
- Harmful proxies abstain in adversarial tests.
- Multiplicity changes the critical value.
- Output is deterministic for frozen inputs and seeds.

## What it does not prove

- finite-sample or graph-aware coverage under arbitrary clustering;
- validity after cross-fitted model selection;
- a no-harm theorem for realized interval width;
- generalization to unseen robots, tasks, sites, or institutions; or
- physical robot safety.

Those are research objectives, not properties silently attributed to the baseline.
