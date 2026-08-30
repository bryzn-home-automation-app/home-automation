'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createAgentOS } = require('../src/index');
const { tmpRoot, cleanup } = require('./helpers');

test('records tokens avoided and cost, and appends to history', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root, model: 'claude-opus' });
    const entry = a.measurement.record({
      task: 'test task',
      agent: 'engineering',
      report: { baselineTokens: 10000, tokensUsed: 1000, keptCount: 3, candidateCount: 50, conflicts: [] },
      usage: { inputTokens: 1000, outputTokens: 100 },
      latencyMs: 42,
      quality: 0.9,
    });
    assert.equal(entry.tokensAvoided, 9000);
    assert.equal(entry.reductionPct, 0.9);
    assert.ok(entry.costAvoidedUsd > 0);
    assert.equal(a.measurement.history().length, 1);
  } finally {
    cleanup(root);
  }
});

test('summarize aggregates multiple measurements', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    const m1 = a.measurement.record({ task: 't1', report: { baselineTokens: 1000, tokensUsed: 100 }, quality: 1 });
    const m2 = a.measurement.record({ task: 't2', report: { baselineTokens: 2000, tokensUsed: 200 }, quality: 0.8 });
    const summary = a.measurement.summarize([{ measurement: m1 }, { measurement: m2 }]);
    assert.equal(summary.tasks, 2);
    assert.equal(summary.baselineTokens, 3000);
    assert.equal(summary.actualTokens, 300);
    assert.equal(summary.tokensAvoided, 2700);
    assert.equal(summary.avgQuality, 0.9);
  } finally {
    cleanup(root);
  }
});
