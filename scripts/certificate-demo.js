import { certifyPolicyGraph } from "../src/policy-certificate.js";

function buildFrame({ harmful }) {
  const populationRows = [];
  const auditRows = [];
  const inferenceRows = [];
  for (const edge of ["baseline::candidate", "baseline::challenger"]) {
    for (let index = 0; index < 36; index += 1) {
      const human = 0.24 + ((index % 7) - 3) * 0.025;
      const proxy = harmful ? -human : human + ((index % 3) - 1) * 0.008;
      const row = { edge, session_id: `${edge}-${index}`, proxy, stratum: index % 2 ? "site-b" : "site-a" };
      populationRows.push(row);
      if (index < 12) auditRows.push({ ...row, human });
      else if (index < 28) inferenceRows.push({ ...row, human });
    }
  }
  return {
    populationRows,
    auditRows,
    inferenceRows,
    alpha: 0.05,
    delta: 0.10,
    gate: {
      minimumPerEdge: 8,
      minimumPerStratum: 4,
      maximumVarianceRatio: 0.40,
      maximumAbsoluteBias: 0.08,
      maximumAbsoluteShiftResidual: 0.08,
      requireShiftStrata: true,
      bootstrapIterations: 400,
      confidence: 0.90,
      seed: 73,
    },
  };
}

function summary(result) {
  return {
    status: result.status,
    branch: result.branch,
    critical_value: result.critical_value,
    decisions: result.edges.map((edge) => ({
      edge: edge.edge,
      method: edge.method,
      estimate: edge.estimate,
      interval: edge.interval,
      decision: edge.decision,
      exact_human_fallback: result.branch === "HUMAN_ONLY"
        ? edge.estimate === edge.human_only.estimate &&
          edge.interval.low === edge.human_only.interval.low &&
          edge.interval.high === edge.human_only.interval.high
        : null,
    })),
  };
}

console.log(JSON.stringify({
  helpful_proxy: summary(certifyPolicyGraph(buildFrame({ harmful: false }))),
  harmful_proxy: summary(certifyPolicyGraph(buildFrame({ harmful: true }))),
}, null, 2));
