import { UserError } from "./errors.js";
import { createRandom } from "./random.js";

// Conservative, executable baseline for the proposed thesis certificate.
//
// The audit and inference samples are disjoint at the session level. The audit
// sample may decide whether a frozen proxy is eligible, but it never contributes
// outcomes to the headline policy-effect intervals. Conditional on that branch
// decision, inference is therefore performed by one of two procedures that were
// fixed before the inference labels were observed:
//   1. human-only finite-frame mean estimation; or
//   2. fixed-lambda prediction-powered mean estimation.
//
// This module intentionally uses Bonferroni-normal intervals. They are a
// transparent engineering baseline, not the proposed graph-aware theorem.

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values) {
  if (values.length < 2) return Number.POSITIVE_INFINITY;
  const center = mean(values);
  return values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
}

function empiricalQuantile(values, probability) {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

// Peter John Acklam's inverse-normal approximation, with one Halley refinement.
export function normalQuantile(probability) {
  if (!(probability > 0 && probability < 1)) {
    throw new UserError("Normal quantile probability must be strictly between zero and one");
  }
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
    138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;
  let estimate;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    estimate = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (probability <= high) {
    const q = probability - 0.5;
    const r = q * q;
    estimate = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    estimate = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  return estimate;
}

function numeric(value, label) {
  if (!Number.isFinite(value)) throw new UserError(`${label} must be a finite number`);
  return Number(value);
}

function rowKey(row) {
  return `${row.edge}\u0000${row.session_id}`;
}

function validateRows(rows, label, { requireHuman }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new UserError(`${label} must be a nonempty array`);
  }
  const keys = new Set();
  for (const [index, row] of rows.entries()) {
    if (typeof row?.edge !== "string" || row.edge === "") {
      throw new UserError(`${label}[${index}] is missing edge`);
    }
    if (typeof row.session_id !== "string" || row.session_id === "") {
      throw new UserError(`${label}[${index}] is missing session_id`);
    }
    numeric(row.proxy, `${label}[${index}].proxy`);
    if (requireHuman) numeric(row.human, `${label}[${index}].human`);
    const key = rowKey(row);
    if (keys.has(key)) throw new UserError(`${label} contains duplicate edge/session row: ${key}`);
    keys.add(key);
  }
  return keys;
}

function groupByEdge(rows) {
  const groups = new Map();
  for (const row of rows) {
    const bucket = groups.get(row.edge) ?? [];
    bucket.push(row);
    groups.set(row.edge, bucket);
  }
  return groups;
}

function varianceRatio(rows) {
  const human = rows.map((row) => row.human);
  const residual = rows.map((row) => row.human - row.proxy);
  const humanVariance = sampleVariance(human);
  const residualVariance = sampleVariance(residual);
  if (humanVariance === 0) return residualVariance === 0 ? 0 : Number.POSITIVE_INFINITY;
  return residualVariance / humanVariance;
}

function bootstrapVarianceRatioUpper(rows, { iterations, confidence, random }) {
  const ratios = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = new Array(rows.length);
    for (let index = 0; index < rows.length; index += 1) {
      sample[index] = rows[Math.floor(random() * rows.length)];
    }
    // Keep infinite ratios. Dropping degenerate bootstrap resamples would make
    // a weak audit look safer than it is; an infinite upper tail must fail.
    ratios.push(varianceRatio(sample));
  }
  return ratios.length === 0 ? Number.POSITIVE_INFINITY : empiricalQuantile(ratios, confidence);
}

function evaluatorGate(auditRows, edges, {
  minimumPerEdge,
  minimumPerStratum,
  maximumVarianceRatio,
  maximumAbsoluteBias,
  maximumAbsoluteShiftResidual,
  requireShiftStrata,
  bootstrapIterations,
  confidence,
  seed,
}) {
  const grouped = groupByEdge(auditRows);
  const random = createRandom(seed);
  const detail = edges.map((edge) => {
    const rows = grouped.get(edge) ?? [];
    const residuals = rows.map((row) => row.human - row.proxy);
    const countPass = rows.length >= minimumPerEdge;
    const ratio = countPass ? varianceRatio(rows) : Number.POSITIVE_INFINITY;
    const ratioUpper = countPass
      ? bootstrapVarianceRatioUpper(rows, { iterations: bootstrapIterations, confidence, random })
      : Number.POSITIVE_INFINITY;
    const absoluteBias = rows.length === 0 ? Number.POSITIVE_INFINITY : Math.abs(mean(residuals));
    const strata = groupByEdge(rows.map((row) => ({ ...row, edge: row.stratum ?? "__unstratified__" })));
    const supportedStrata = [...strata.entries()]
      .filter(([, stratumRows]) => stratumRows.length >= minimumPerStratum)
      .map(([stratum, stratumRows]) => ({
        stratum,
        labels: stratumRows.length,
        absolute_residual_bias: Math.abs(mean(stratumRows.map((row) => row.human - row.proxy))),
      }));
    const shiftSupportPass = !requireShiftStrata || supportedStrata.length >= 2;
    const maximumShiftResidual = supportedStrata.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(...supportedStrata.map((stratum) => stratum.absolute_residual_bias));
    const shiftPass = shiftSupportPass && maximumShiftResidual <= maximumAbsoluteShiftResidual;
    const pass = countPass && ratioUpper <= maximumVarianceRatio &&
      absoluteBias <= maximumAbsoluteBias && shiftPass;
    return {
      edge,
      audit_labels: rows.length,
      residual_variance_ratio: ratio,
      residual_variance_ratio_upper: ratioUpper,
      absolute_residual_bias: absoluteBias,
      maximum_supported_stratum_residual: maximumShiftResidual,
      supported_strata: supportedStrata,
      pass,
      failures: [
        !countPass ? `audit labels ${rows.length} < ${minimumPerEdge}` : null,
        countPass && ratioUpper > maximumVarianceRatio
          ? `variance-ratio upper bound ${ratioUpper.toFixed(4)} > ${maximumVarianceRatio}`
          : null,
        absoluteBias > maximumAbsoluteBias
          ? `absolute residual bias ${absoluteBias.toFixed(4)} > ${maximumAbsoluteBias}`
          : null,
        !shiftSupportPass ? `shift gate needs at least two strata with ${minimumPerStratum} labels` : null,
        shiftSupportPass && maximumShiftResidual > maximumAbsoluteShiftResidual
          ? `maximum stratum residual ${maximumShiftResidual.toFixed(4)} > ${maximumAbsoluteShiftResidual}`
          : null,
      ].filter(Boolean),
    };
  });
  return {
    pass: detail.every((edge) => edge.pass),
    rule: "every prespecified edge must pass audit count, bootstrap residual-variance, and bias gates",
    configuration: {
      minimum_per_edge: minimumPerEdge,
      minimum_per_stratum: minimumPerStratum,
      maximum_variance_ratio: maximumVarianceRatio,
      maximum_absolute_bias: maximumAbsoluteBias,
      maximum_absolute_shift_residual: maximumAbsoluteShiftResidual,
      require_shift_strata: requireShiftStrata,
      bootstrap_iterations: bootstrapIterations,
      confidence,
      seed,
    },
    edges: detail,
  };
}

function finiteFrameStandardError(values, populationSize) {
  const sampleSize = values.length;
  if (sampleSize < 2) return Number.POSITIVE_INFINITY;
  if (sampleSize > populationSize) {
    throw new UserError(`Inference labels ${sampleSize} exceed population size ${populationSize}`);
  }
  const fpc = sampleSize === populationSize ? 0 : Math.sqrt((populationSize - sampleSize) / (populationSize - 1));
  return fpc * Math.sqrt(sampleVariance(values) / sampleSize);
}

function decision(interval, delta) {
  if (interval.low > delta) return "CANDIDATE_SUPERIOR";
  if (interval.high < -delta) return "BASELINE_SUPERIOR";
  if (interval.low >= -delta && interval.high <= delta) return "PRACTICALLY_EQUIVALENT";
  return "UNRESOLVED";
}

function edgeInference({ edge, population, inference, branch, criticalValue, delta }) {
  const proxyByKey = new Map(population.map((row) => [rowKey(row), row.proxy]));
  for (const row of inference) {
    if (!proxyByKey.has(rowKey(row))) {
      throw new UserError(`Inference row is outside the frozen proxy population: ${rowKey(row)}`);
    }
    if (proxyByKey.get(rowKey(row)) !== row.proxy) {
      throw new UserError(`Inference proxy disagrees with frozen population for ${rowKey(row)}`);
    }
  }
  const human = inference.map((row) => row.human);
  const residual = inference.map((row) => row.human - row.proxy);
  const humanEstimate = mean(human);
  const proxyMean = mean(population.map((row) => row.proxy));
  const ppiEstimate = proxyMean + mean(residual);
  const humanSe = finiteFrameStandardError(human, population.length);
  const ppiSe = finiteFrameStandardError(residual, population.length);
  const selectedEstimate = branch === "PPI" ? ppiEstimate : humanEstimate;
  const selectedSe = branch === "PPI" ? ppiSe : humanSe;
  const interval = {
    low: selectedEstimate - criticalValue * selectedSe,
    high: selectedEstimate + criticalValue * selectedSe,
  };
  return {
    edge,
    population_sessions: population.length,
    inference_labels: inference.length,
    method: branch === "PPI" ? "fixed_lambda_1_ppi" : "human_only",
    estimate: selectedEstimate,
    standard_error: selectedSe,
    interval,
    decision: decision(interval, delta),
    human_only: {
      estimate: humanEstimate,
      standard_error: humanSe,
      interval: {
        low: humanEstimate - criticalValue * humanSe,
        high: humanEstimate + criticalValue * humanSe,
      },
    },
    fixed_ppi: {
      estimate: ppiEstimate,
      standard_error: ppiSe,
      interval: {
        low: ppiEstimate - criticalValue * ppiSe,
        high: ppiEstimate + criticalValue * ppiSe,
      },
    },
  };
}

export function certifyPolicyGraph({
  auditRows,
  inferenceRows,
  populationRows,
  alpha = 0.05,
  delta = 0,
  gate = {},
} = {}) {
  const populationKeys = validateRows(populationRows, "populationRows", { requireHuman: false });
  validateRows(auditRows, "auditRows", { requireHuman: true });
  validateRows(inferenceRows, "inferenceRows", { requireHuman: true });
  if (!(alpha > 0 && alpha < 1)) throw new UserError("alpha must be strictly between zero and one");
  if (!(delta >= 0 && Number.isFinite(delta))) throw new UserError("delta must be a finite nonnegative number");

  const auditSessions = new Set(auditRows.map((row) => row.session_id));
  const leakage = inferenceRows.find((row) => auditSessions.has(row.session_id));
  if (leakage) {
    throw new UserError(`Audit and inference labels must be session-disjoint; leaked session: ${leakage.session_id}`);
  }
  for (const row of [...auditRows, ...inferenceRows]) {
    if (!populationKeys.has(rowKey(row))) {
      throw new UserError(`Labeled row is outside the frozen proxy population: ${rowKey(row)}`);
    }
  }

  const population = groupByEdge(populationRows);
  const inference = groupByEdge(inferenceRows);
  const edges = [...population.keys()].sort();
  const absentInference = edges.filter((edge) => !(inference.get(edge)?.length >= 2));
  if (absentInference.length > 0) {
    throw new UserError(`Every prespecified edge needs at least two inference labels: ${absentInference.join(", ")}`);
  }
  const foreignEdges = [...new Set([...auditRows, ...inferenceRows].map((row) => row.edge))]
    .filter((edge) => !population.has(edge));
  if (foreignEdges.length > 0) throw new UserError(`Labels contain edges outside the population: ${foreignEdges.join(", ")}`);

  const gateResult = evaluatorGate(auditRows, edges, {
    minimumPerEdge: gate.minimumPerEdge ?? 8,
    minimumPerStratum: gate.minimumPerStratum ?? 3,
    maximumVarianceRatio: gate.maximumVarianceRatio ?? 0.90,
    maximumAbsoluteBias: gate.maximumAbsoluteBias ?? Math.max(delta / 2, 0.05),
    maximumAbsoluteShiftResidual: gate.maximumAbsoluteShiftResidual ?? Math.max(delta / 2, 0.05),
    requireShiftStrata: gate.requireShiftStrata ?? false,
    bootstrapIterations: gate.bootstrapIterations ?? 2000,
    confidence: gate.confidence ?? 0.90,
    seed: gate.seed ?? 20260824,
  });
  const branch = gateResult.pass ? "PPI" : "HUMAN_ONLY";
  const criticalValue = normalQuantile(1 - alpha / (2 * edges.length));
  const results = edges.map((edge) => edgeInference({
    edge,
    population: population.get(edge),
    inference: inference.get(edge),
    branch,
    criticalValue,
    delta,
  }));
  const counts = results.reduce((summary, result) => {
    summary[result.decision] = (summary[result.decision] ?? 0) + 1;
    return summary;
  }, {});

  return {
    certificate_version: "conservative-split-bonferroni-v1",
    status: gateResult.pass ? "PROXY_ELIGIBLE" : "ABSTAINED_TO_HUMAN_ONLY",
    branch,
    claim_boundary: "finite-frame normal-approximation baseline; not a physical-safety certificate or graph-aware theorem",
    alpha,
    simultaneous_coverage_target: 1 - alpha,
    multiplicity_method: "bonferroni_two_sided_normal",
    critical_value: criticalValue,
    practical_equivalence_margin: delta,
    gate: gateResult,
    edges: results,
    decision_counts: counts,
  };
}
