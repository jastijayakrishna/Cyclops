# Reproducibility and evidence contract

## Two levels of reproduction

### Repository-level verification

This level requires no benchmark download. It validates parsers, matched comparisons, uncertainty propagation, data boundaries, fail-closed calibration, research-package integrity, and deterministic stochastic routines.

```powershell
node --version
npm ci
npm run check
node --test --experimental-test-coverage
```

Expected runtime: Node.js 22 or newer. `npm run check` must pass the data-boundary check, research-package check, and all automated tests.

### Full empirical reproduction

This level retrieves public metadata and public prediction JSON to a directory outside the repository. It does not require video download or new inference.

```powershell
node .\bin\roboeval.js fetch-roboarena-metadata `
  --target C:\path\outside-repo\DataDump_07-17-2026

node .\bin\roboeval.js import-roboarena `
  --data-root C:\path\outside-repo\DataDump_07-17-2026 `
  --output C:\path\outside-repo\normalized-07-17-2026.jsonl

node .\scripts\fetch-roboreward-bench.js `
  --target C:\path\outside-repo\roboreward-bench-v0.0.1

node .\scripts\public-prediction-ppi-study.js `
  --population C:\path\outside-repo\normalized-07-17-2026.jsonl `
  --benchmark-root C:\path\outside-repo\roboreward-bench-v0.0.1 `
  --output C:\path\outside-repo\roboreward-bench-v0.0.1\policy-ppi-results.json `
  --repetitions 1000 `
  --seed 20260813
```

The fetcher records source URLs, retrieval time, byte counts, and SHA-256 hashes. The result report must retain parse exclusions, unmatched joins, conflicts, analysis options, model identifiers, and random seeds.

## Artifact policy

Raw datasets, videos, arrays, archives, model predictions, and full generated evidence remain outside Git. Repository files may include schemas, code, documentation, small fixtures, checksums, and derived summaries below the 5 MiB boundary.

`results/exploratory-summary.json` is a review index transcribed from dated reports. Its field `independently_recomputed_in_this_repository` is intentionally false. It must not be cited as an independent raw-data reproduction.

## Determinism and versioning

- All Monte Carlo analyses use explicit seeds.
- Stable video stems—not mutable HELM numeric suffixes—join predictions across releases.
- Camera predictions are aggregated within policy episodes before matched-session construction.
- Model, prompt, parser, data manifest, analysis options, code revision, and output hash belong in every confirmatory result record.
- A public release should use an immutable Git tag and archived DOI; creating that release is a separate authorized action.

## Claim audit

Before sharing a result, verify that it distinguishes exploratory from confirmatory evidence, reference disagreement from gold-label error, finite-set reconstruction from population generalization, and software verification from scientific confirmation.
