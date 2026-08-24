import test from "node:test";
import assert from "node:assert/strict";
import { certifyPolicyGraph, normalQuantile } from "../src/policy-certificate.js";

function frame({ harmful = false } = {}) {
  const edges = ["policy-a::policy-b", "policy-a::policy-c"];
  const populationRows = [];
  const auditRows = [];
  const inferenceRows = [];
  for (const [edgeIndex, edge] of edges.entries()) {
    for (let index = 0; index < 40; index += 1) {
      const human = 0.28 + edgeIndex * 0.06 + ((index % 7) - 3) * 0.025;
      const helpfulProxy = human + ((index % 3) - 1) * 0.008;
      const proxy = harmful ? -human + ((index % 3) - 1) * 0.02 : helpfulProxy;
      const row = { edge, session_id: `${edgeIndex}-${index}`, proxy, stratum: index % 2 ? "site-b" : "site-a" };
      populationRows.push(row);
      if (index < 12) auditRows.push({ ...row, human });
      else if (index < 28) inferenceRows.push({ ...row, human });
    }
  }
  return { populationRows, auditRows, inferenceRows };
}

const gate = {
  minimumPerEdge: 8,
  maximumVarianceRatio: 0.40,
  maximumAbsoluteBias: 0.08,
  maximumAbsoluteShiftResidual: 0.08,
  minimumPerStratum: 4,
  requireShiftStrata: true,
  bootstrapIterations: 400,
  confidence: 0.90,
  seed: 73,
};

test("normal critical values are accurate enough for auditable multiplicity correction", () => {
  assert.ok(Math.abs(normalQuantile(0.975) - 1.9599639845) < 1e-6);
  assert.ok(normalQuantile(0.9875) > normalQuantile(0.975));
});

test("uses fixed PPI only after every policy edge passes the separated audit gate", () => {
  const result = certifyPolicyGraph({ ...frame(), alpha: 0.05, delta: 0.10, gate });
  assert.equal(result.status, "PROXY_ELIGIBLE");
  assert.equal(result.branch, "PPI");
  assert.ok(result.gate.edges.every((edge) => edge.pass));
  assert.ok(result.edges.every((edge) => edge.method === "fixed_lambda_1_ppi"));
  assert.ok(result.edges.every((edge) => edge.decision === "CANDIDATE_SUPERIOR"));
});

test("a harmful proxy produces the exact frozen human-only fallback", () => {
  const result = certifyPolicyGraph({ ...frame({ harmful: true }), alpha: 0.05, delta: 0.10, gate });
  assert.equal(result.status, "ABSTAINED_TO_HUMAN_ONLY");
  assert.equal(result.branch, "HUMAN_ONLY");
  assert.ok(result.gate.edges.some((edge) => !edge.pass));
  for (const edge of result.edges) {
    assert.equal(edge.method, "human_only");
    assert.equal(edge.estimate, edge.human_only.estimate);
    assert.deepEqual(edge.interval, edge.human_only.interval);
  }
});

test("abstains when a proxy hides a large residual inside one supported shift stratum", () => {
  const input = frame();
  input.auditRows = input.auditRows.map((row) => row.stratum === "site-b"
    ? { ...row, proxy: row.proxy + 0.18 }
    : row);
  input.populationRows = input.populationRows.map((row) => {
    const changed = input.auditRows.find((audit) => audit.edge === row.edge && audit.session_id === row.session_id);
    return changed ? { ...row, proxy: changed.proxy } : row;
  });
  const result = certifyPolicyGraph({ ...input, alpha: 0.05, delta: 0.10, gate });
  assert.equal(result.status, "ABSTAINED_TO_HUMAN_ONLY");
  assert.ok(result.gate.edges.some((edge) => edge.failures.some((failure) => failure.includes("stratum residual"))));
});

test("the graph-wide interval uses a stricter critical value than a marginal 95% interval", () => {
  const result = certifyPolicyGraph({ ...frame(), alpha: 0.05, delta: 0.10, gate });
  assert.ok(result.critical_value > 1.9599639845);
  assert.equal(result.multiplicity_method, "bonferroni_two_sided_normal");
  assert.equal(result.edges.length, 2);
});

test("bootstrap gating and certificate output are deterministic for a frozen seed", () => {
  const input = { ...frame(), alpha: 0.05, delta: 0.10, gate };
  assert.deepEqual(certifyPolicyGraph(input), certifyPolicyGraph(input));
});

test("rejects audit/inference leakage at the session level even across different edges", () => {
  const input = frame();
  input.inferenceRows[0] = { ...input.inferenceRows[0], session_id: input.auditRows[0].session_id };
  assert.throws(
    () => certifyPolicyGraph({ ...input, delta: 0.10, gate }),
    /session-disjoint/,
  );
});

test("rejects a missing prespecified edge instead of silently narrowing the graph", () => {
  const input = frame();
  input.inferenceRows = input.inferenceRows.filter((row) => row.edge !== "policy-a::policy-c");
  assert.throws(
    () => certifyPolicyGraph({ ...input, delta: 0.10, gate }),
    /Every prespecified edge needs at least two inference labels/,
  );
});
