import { createRandom } from "./random.js";
import { UserError } from "./errors.js";

const Z975 = 1.959963984540054;

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleVariance(values) {
  if (values.length < 2) return 0;
  const center = mean(values);
  return values.reduce((sum, value) => sum + (value - center) ** 2, 0) / (values.length - 1);
}

function sampleCovariance(left, right) {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = mean(left);
  const rightMean = mean(right);
  return left.reduce((sum, value, index) =>
    sum + (value - leftMean) * (right[index] - rightMean), 0) / (left.length - 1);
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

// Cornish-Fisher expansion of the 97.5% Student-t quantile. The study never
// uses fewer than five revealed labels, where this is accurate enough for the
// repeated-sampling coverage diagnostic. At large df it converges to z=1.96.
function t975(df) {
  if (!(df > 0)) return Number.POSITIVE_INFINITY;
  const z = Z975;
  const z2 = z * z;
  const first = (z ** 3 + z) / (4 * df);
  const second = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
  const third = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3);
  return z + first + second + third + 0 * z2;
}

export function parseRoboRewardInstanceId(instanceId) {
  if (typeof instanceId !== "string") return null;
  const match = instanceId.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Z])_([^:]+):(\d+)$/iu);
  if (!match) return null;
  return {
    comparison_id: match[1].toLowerCase(),
    slot: match[2].toUpperCase(),
    view: match[3],
    benchmark_index: Number(match[4]),
    trial_id: `${match[1].toLowerCase()}:${match[2].toUpperCase()}`,
    stable_id: `${match[1].toLowerCase()}_${match[2].toUpperCase()}_${match[3]}`,
  };
}

export function parseProgressPrediction(text) {
  if (typeof text !== "string") return null;
  const answer = text.match(/ANSWER\s*:\s*(?:\*\*)?([1-5])(?:\*\*)?/iu);
  if (answer) return Number(answer[1]);
  const stripped = text.trim().replace(/^\*\*|\*\*$/gu, "").trim();
  return /^[1-5]$/u.test(stripped) ? Number(stripped) : null;
}

function referenceScore(instance) {
  const raw = instance?.references?.find((reference) => reference?.tags?.includes("correct"))?.output?.text;
  const score = Number(String(raw ?? "").trim());
  return Number.isInteger(score) && score >= 1 && score <= 5 ? score : null;
}

export function buildEpisodeFrame({ instances, predictions, population }) {
  if (!Array.isArray(instances) || !Array.isArray(predictions) || !Array.isArray(population)) {
    throw new UserError("instances, predictions, and population must be arrays");
  }
  const metadata = new Map(population.map((record) => [record.trial_id, record]));
  // HELM regenerated the numeric suffix in instance_id for later model runs.
  // The video stem (session UUID, policy slot, camera) is stable; the suffix is
  // not. Joining on the full ID silently loses otherwise valid newer runs.
  const predictionByStableId = new Map();
  let duplicatePredictionStems = 0;
  for (const prediction of predictions) {
    const parsed = parseRoboRewardInstanceId(prediction.instance_id);
    if (!parsed) continue;
    if (predictionByStableId.has(parsed.stable_id)) duplicatePredictionStems += 1;
    else predictionByStableId.set(parsed.stable_id, prediction);
  }
  const grouped = new Map();
  const diagnostics = {
    instances: instances.length,
    predictions: predictions.length,
    invalid_instance_ids: 0,
    invalid_references: 0,
    missing_predictions: 0,
    unparseable_predictions: 0,
    unmatched_population: 0,
    conflicting_reference_episodes: 0,
    duplicate_prediction_stems: duplicatePredictionStems,
  };

  for (const instance of instances) {
    const parsed = parseRoboRewardInstanceId(instance.id);
    if (!parsed) { diagnostics.invalid_instance_ids += 1; continue; }
    const reference = referenceScore(instance);
    if (reference === null) { diagnostics.invalid_references += 1; continue; }
    const prediction = predictionByStableId.get(parsed.stable_id);
    if (!prediction) { diagnostics.missing_predictions += 1; continue; }
    const predicted = parseProgressPrediction(prediction.predicted_text);
    if (predicted === null) { diagnostics.unparseable_predictions += 1; continue; }
    const record = metadata.get(parsed.trial_id);
    if (!record) { diagnostics.unmatched_population += 1; continue; }
    let episode = grouped.get(parsed.trial_id);
    if (!episode) {
      episode = { metadata: record, references: [], predictions: [], views: [] };
      grouped.set(parsed.trial_id, episode);
    }
    episode.references.push(reference);
    episode.predictions.push(predicted);
    episode.views.push(parsed.view);
  }

  const episodes = [];
  for (const [trialId, group] of grouped) {
    const distinctReferences = [...new Set(group.references)];
    if (distinctReferences.length !== 1) {
      diagnostics.conflicting_reference_episodes += 1;
      continue;
    }
    episodes.push({
      trial_id: trialId,
      comparison_id: group.metadata.comparison_id,
      policy: group.metadata.policy,
      task: group.metadata.task,
      site: group.metadata.site,
      reference_score: distinctReferences[0],
      prediction_score: mean(group.predictions),
      view_count: group.predictions.length,
      views: [...new Set(group.views)].sort(),
    });
  }
  episodes.sort((left, right) => left.trial_id.localeCompare(right.trial_id));
  return { episodes, diagnostics };
}

export function buildPolicyPairFrames(episodes, { minSessions = 50 } = {}) {
  if (!Array.isArray(episodes)) throw new UserError("episodes must be an array");
  const sessions = new Map();
  for (const episode of episodes) {
    let session = sessions.get(episode.comparison_id);
    if (!session) { session = new Map(); sessions.set(episode.comparison_id, session); }
    session.set(episode.policy, episode);
  }
  const pairs = new Map();
  for (const [comparisonId, session] of sessions) {
    const policies = [...session.keys()].sort();
    for (let left = 0; left < policies.length; left += 1) {
      for (let right = left + 1; right < policies.length; right += 1) {
        const baseline = policies[left];
        const candidate = policies[right];
        const key = `${baseline}||${candidate}`;
        let frame = pairs.get(key);
        if (!frame) { frame = { baseline, candidate, rows: [] }; pairs.set(key, frame); }
        const base = session.get(baseline);
        const cand = session.get(candidate);
        frame.rows.push({
          comparison_id: comparisonId,
          site: cand.site,
          task: cand.task,
          human: cand.reference_score - base.reference_score,
          proxy: cand.prediction_score - base.prediction_score,
        });
      }
    }
  }
  return [...pairs.values()]
    .filter((pair) => pair.rows.length >= minSessions)
    .sort((left, right) => `${left.baseline}||${left.candidate}`.localeCompare(`${right.baseline}||${right.candidate}`));
}

export function pairedMeanSummary(values) {
  if (!Array.isArray(values) || values.length < 2) throw new UserError("A paired mean needs at least two values");
  const estimate = mean(values);
  const standardError = Math.sqrt(sampleVariance(values) / values.length);
  const critical = t975(values.length - 1);
  const interval95 = { low: estimate - critical * standardError, high: estimate + critical * standardError };
  return {
    n: values.length,
    estimate,
    standard_error: standardError,
    interval95,
    decision: interval95.low > 0 ? "CANDIDATE_BETTER" : interval95.high < 0 ? "BASELINE_BETTER" : "INSUFFICIENT_EVIDENCE",
  };
}

export function summarizePairDistortion(pair) {
  const human = pairedMeanSummary(pair.rows.map((row) => row.human));
  const proxy = pairedMeanSummary(pair.rows.map((row) => row.proxy));
  return {
    pair: `${pair.baseline} -> ${pair.candidate}`,
    baseline: pair.baseline,
    candidate: pair.candidate,
    n: pair.rows.length,
    human,
    proxy,
    effect_shift: proxy.estimate - human.estimate,
    sign_reversal: Math.sign(proxy.estimate) !== 0 && Math.sign(human.estimate) !== 0 && Math.sign(proxy.estimate) !== Math.sign(human.estimate),
    decision_change: proxy.decision !== human.decision,
  };
}

export function ppiVarianceRatios(rows) {
  if (!Array.isArray(rows) || rows.length < 3) throw new UserError("PPI variance needs at least three rows");
  const human = rows.map((row) => row.human);
  const proxy = rows.map((row) => row.proxy);
  const humanVariance = sampleVariance(human);
  const proxyVariance = sampleVariance(proxy);
  const lambda = proxyVariance === 0 ? 0 : clamp(sampleCovariance(human, proxy) / proxyVariance, 0, 1);
  const residualVariance = (weight) => sampleVariance(human.map((value, index) => value - weight * proxy[index]));
  return {
    fixed_lambda: 1,
    fixed_variance_ratio: humanVariance === 0 ? null : residualVariance(1) / humanVariance,
    oracle_lambda: lambda,
    oracle_variance_ratio: humanVariance === 0 ? null : residualVariance(lambda) / humanVariance,
  };
}

function drawIndices(total, count, random) {
  const indices = Array.from({ length: total }, (_, index) => index);
  for (let index = 0; index < count; index += 1) {
    const selected = index + Math.floor(random() * (total - index));
    [indices[index], indices[selected]] = [indices[selected], indices[index]];
  }
  return indices.slice(0, count);
}

function finitePopulationEstimate({ human, proxy, selected, lambda, estimatedParameters = 0 }) {
  const total = human.length;
  const proxyMean = mean(proxy);
  const residuals = selected.map((index) => human[index] - lambda * proxy[index]);
  const estimate = lambda * proxyMean + mean(residuals);
  const correction = Math.max(0, 1 - selected.length / total);
  const residualMean = mean(residuals);
  const degreesOfFreedom = selected.length - 1 - estimatedParameters;
  const residualVariance = degreesOfFreedom <= 0 ? Number.POSITIVE_INFINITY
    : residuals.reduce((sum, value) => sum + (value - residualMean) ** 2, 0) / degreesOfFreedom;
  const standardError = Math.sqrt(correction * residualVariance / selected.length);
  const halfWidth = selected.length === total ? 0 : t975(degreesOfFreedom) * standardError;
  return { estimate, interval95: { low: estimate - halfWidth, high: estimate + halfWidth }, width: 2 * halfWidth };
}

export function simulateLabelEfficiency(rows, {
  fractions = [0.1, 0.2, 0.3, 0.5],
  repetitions = 1000,
  seed = 20260813,
} = {}) {
  if (!Array.isArray(rows) || rows.length < 5) throw new UserError("Label simulation needs at least five rows");
  const human = rows.map((row) => row.human);
  const proxy = rows.map((row) => row.proxy);
  const target = mean(human);
  const random = createRandom(seed);
  const results = [];
  for (const fraction of fractions) {
    if (!(fraction > 0 && fraction <= 1)) throw new UserError(`Invalid label fraction ${fraction}`);
    const count = Math.max(5, Math.min(rows.length, Math.round(rows.length * fraction)));
    const methods = new Map(["human_only", "fixed_ppi", "adaptive_ppi"].map((name) => [name, {
      name, covered: 0, absolute_error_sum: 0, squared_error_sum: 0, width_sum: 0, rank_agreement: 0, lambda_sum: 0,
    }]));
    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      const selected = drawIndices(rows.length, count, random);
      const selectedHuman = selected.map((index) => human[index]);
      const selectedProxy = selected.map((index) => proxy[index]);
      const proxyVariance = sampleVariance(selectedProxy);
      const adaptiveLambda = proxyVariance === 0 ? 0 : clamp(sampleCovariance(selectedHuman, selectedProxy) / proxyVariance, 0, 1);
      for (const [name, lambda] of [["human_only", 0], ["fixed_ppi", 1], ["adaptive_ppi", adaptiveLambda]]) {
        // Adaptive lambda is a fitted regression coefficient. Deduct its one
        // degree of freedom unless clipping has selected the exact human-only
        // fallback. Without this correction small-label intervals undercover.
        const estimatedParameters = name === "adaptive_ppi" && lambda > 0 ? 1 : 0;
        const estimate = finitePopulationEstimate({ human, proxy, selected, lambda, estimatedParameters });
        const error = estimate.estimate - target;
        const bucket = methods.get(name);
        if (estimate.interval95.low <= target && target <= estimate.interval95.high) bucket.covered += 1;
        bucket.absolute_error_sum += Math.abs(error);
        bucket.squared_error_sum += error ** 2;
        bucket.width_sum += estimate.width;
        bucket.rank_agreement += Math.sign(estimate.estimate) === Math.sign(target) ? 1 : 0;
        bucket.lambda_sum += lambda;
      }
    }
    results.push({
      fraction,
      labels: count,
      population: rows.length,
      target,
      repetitions,
      methods: Object.fromEntries([...methods].map(([name, bucket]) => [name, {
        coverage: bucket.covered / repetitions,
        mean_absolute_error: bucket.absolute_error_sum / repetitions,
        root_mean_squared_error: Math.sqrt(bucket.squared_error_sum / repetitions),
        mean_interval_width: bucket.width_sum / repetitions,
        ranking_agreement: bucket.rank_agreement / repetitions,
        mean_lambda: bucket.lambda_sum / repetitions,
      }])),
    });
  }
  return results;
}

export const PUBLIC_BENCHMARK_INTERNALS = { mean, sampleVariance, sampleCovariance, t975 };
