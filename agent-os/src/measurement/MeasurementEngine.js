'use strict';

const fs = require('fs');
const path = require('path');

/**
 * The Measurement Engine quantifies the core thesis: memory can be large,
 * context should be small. For every task it compares:
 *
 *   baselineTokens  — what a naive agent would send (all of memory + the task),
 *   actualTokens    — what the Context Compiler actually assembled,
 *   tokensAvoided   — baseline - actual,
 *   reductionPct    — tokensAvoided / baseline,
 *
 * plus cost (from configurable per-model pricing), latency, and an optional
 * task-quality score the host can supply. Measurements append to a JSONL log so
 * savings can be tracked over time and audited.
 */
class MeasurementEngine {
  constructor(config) {
    this.config = config;
    this.file = config.paths.measurements;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }

  _price() {
    return this.config.pricing[this.config.model] || this.config.pricing.default;
  }

  /**
   * Record one task measurement.
   * @param {{task, agent, report, usage?, latencyMs?, quality?}} m
   */
  record(m) {
    const report = m.report || {};
    const actualTokens = report.tokensUsed || 0;
    const baselineTokens = report.baselineTokens || 0;
    const tokensAvoided = Math.max(0, baselineTokens - actualTokens);
    const reductionPct = baselineTokens > 0 ? tokensAvoided / baselineTokens : 0;

    const price = this._price();
    // Cost of the context we actually sent, and the cost we would have paid
    // sending the naive baseline instead (both at input pricing).
    const actualCostUsd = (actualTokens / 1e6) * price.input;
    const baselineCostUsd = (baselineTokens / 1e6) * price.input;
    // If real usage came back from the model, fold output cost into actual.
    const outputTokens = m.usage && m.usage.outputTokens ? m.usage.outputTokens : 0;
    const outputCostUsd = (outputTokens / 1e6) * price.output;

    const entry = {
      ts: new Date().toISOString(),
      task: m.task,
      agent: m.agent || null,
      model: this.config.model,
      baselineTokens,
      actualTokens,
      tokensAvoided,
      reductionPct: round(reductionPct, 4),
      actualCostUsd: round(actualCostUsd + outputCostUsd, 6),
      baselineCostUsd: round(baselineCostUsd, 6),
      costAvoidedUsd: round(baselineCostUsd - actualCostUsd, 6),
      outputTokens,
      latencyMs: m.latencyMs != null ? m.latencyMs : null,
      quality: m.quality != null ? m.quality : null,
      keptCount: report.keptCount,
      candidateCount: report.candidateCount,
      compressedRecords: report.compressedRecords,
      conflicts: (report.conflicts || []).length,
    };

    fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
    return entry;
  }

  /** Aggregate a set of per-task results (from Orchestrator.run). */
  summarize(results) {
    const entries = results.map((r) => r && r.measurement).filter(Boolean);
    if (!entries.length) return { tasks: 0 };
    const sum = (f) => entries.reduce((a, e) => a + (e[f] || 0), 0);
    const baseline = sum('baselineTokens');
    const actual = sum('actualTokens');
    const qualities = entries.map((e) => e.quality).filter((q) => q != null);
    return {
      tasks: entries.length,
      baselineTokens: baseline,
      actualTokens: actual,
      tokensAvoided: baseline - actual,
      reductionPct: baseline > 0 ? round((baseline - actual) / baseline, 4) : 0,
      costAvoidedUsd: round(sum('costAvoidedUsd'), 6),
      actualCostUsd: round(sum('actualCostUsd'), 6),
      avgLatencyMs: round(sum('latencyMs') / entries.length, 1),
      avgQuality: qualities.length ? round(qualities.reduce((a, b) => a + b, 0) / qualities.length, 3) : null,
    };
  }

  /** Read the full measurement history from the JSONL log. */
  history() {
    try {
      return fs
        .readFileSync(this.file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }
}

function round(n, dp) {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

module.exports = { MeasurementEngine };
