# ADR-0002: Public VLM predictions and prediction-powered policy inference

- **Status:** Accepted for exploratory validation
- **Date:** 2026-08-13

## Decision

Use released HELM RoboRewardBench per-item predictions as the automatic-evaluator evidence for the no-new-inference study. Join each prediction to RoboArena using the stable video stem—session UUID, policy slot, and camera view—because HELM's trailing numeric instance index changes between model runs. Average multiple camera predictions within one policy episode, then construct candidate-minus-baseline differences only inside matched sessions.

Target the finite benchmark-set mean of the human-verified 1-5 progress difference. Compare naive VLM substitution with human-only reconstruction, fixed prediction-powered inference, and an exploratory clipped regression-adaptive correction. Fixed PPI is the primary label-efficiency method because its correction weight is not selected from the same small revealed-label sample. Adaptive results must report empirical coverage and cannot support a label-saving claim when coverage is deficient.

Keep downloaded JSON, manifests, and generated result files outside Git. Store public source URLs, byte sizes, and SHA-256 hashes in the external manifest. Do not download media for this analysis.

## Alternatives considered

- **Run the frozen Gemini prompt:** rejected for this study because it requires new inference and tests a different binary/eight-frame contract. It remains the only way to make a claim about that exact prompt.
- **Treat camera views as observations:** rejected because it duplicates policy episodes and creates pseudoreplication.
- **Join on the full HELM instance ID:** rejected because the numeric suffix is release-run metadata rather than stable episode identity and silently drops newer models.
- **Choose the lowest-MAE model and report it alone:** rejected because selection used the same released reference set; all model results and the post-hoc status must remain visible.
- **Use adaptive PPI as the primary method:** rejected until independent or cross-fitted validation demonstrates nominal coverage at small label budgets.
- **Use model consensus without references:** rejected because agreement cannot identify correctness or calibrate policy effects.

## Guarantees and limits

The design guarantees deterministic numeric results for a fixed external manifest, analysis options, and seed; exact session matching; no camera-level pseudoreplication; explicit parse losses; and a fail-visible distinction between helpful and harmful proxies.

It does not guarantee that RoboRewardBench references are gold, that a released prompt equals the frozen pilot prompt, that selected models generalize to future tasks, that finite-set reconstruction implies population validity, or that a model with low episode MAE saves human labels.

Revisit this ADR before confirmatory analysis. That revision must freeze model selection, practical-effect thresholds, task/site stratification, and the independent evaluation split before its labels are examined.
