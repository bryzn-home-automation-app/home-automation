'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createAgentOS, UsageGovernor } = require('../src/index');
const { tmpRoot, cleanup } = require('./helpers');

// A model client with fixed, predictable token usage per task.
function fixedUsageClient(tokens = 200) {
  return async () => ({ text: 'ok', usage: { inputTokens: tokens, outputTokens: 0 } });
}

test('classify maps usage fraction to the three phases', () => {
  const root = tmpRoot();
  try {
    const g = new UsageGovernor({ paths: { root } }, { budgetTokens: 1000, conserveAt: 0.8, prepareAt: 0.9 });
    assert.equal(g.classify(0.5), 'normal');
    assert.equal(g.classify(0.85), 'conserve');
    assert.equal(g.classify(0.95), 'prepare');
  } finally {
    cleanup(root);
  }
});

test('a usageProbe overrides token self-tracking', () => {
  const root = tmpRoot();
  try {
    let pct = 0.5;
    const g = new UsageGovernor({ paths: { root } }, { usageProbe: () => pct });
    assert.equal(g.classify(), 'normal');
    pct = 0.92;
    assert.equal(g.classify(), 'prepare');
  } finally {
    cleanup(root);
  }
});

test('runGoverned finishes the safe step, stops, and schedules a resume near the cap', async () => {
  const root = tmpRoot();
  try {
    const scheduled = [];
    const t0 = 1_000_000;
    const ai = createAgentOS({
      root,
      modelClient: fixedUsageClient(200),
      governor: {
        budgetTokens: 400, // 2 tasks (400 tokens) → 100% → prepare
        prepareAt: 0.9,
        windowMs: 5 * 3600 * 1000,
        clock: () => t0,
        scheduler: async (resumeAt, payload) => { scheduled.push({ resumeAt, payload }); },
      },
    });

    const out = await ai.runGoverned('do a\nand then do b\nand then do c');
    assert.equal(out.status, 'stopped');
    assert.equal(out.completed.length, 2, 'finished two safe steps');
    assert.equal(out.remaining.length, 1, 'one subtask checkpointed');
    assert.ok(out.resumePlan.scheduled, 'resume was scheduled');
    assert.equal(scheduled.length, 1);
    // Resume is set for the window reset (start + 5h).
    assert.equal(new Date(out.resumePlan.resumeAt).getTime(), t0 + 5 * 3600 * 1000);
  } finally {
    cleanup(root);
  }
});

test('resume waits until the window resets, then continues automatically', async () => {
  const root = tmpRoot();
  try {
    const t0 = 2_000_000;
    const windowMs = 5 * 3600 * 1000;

    // Session 1: run until the governor stops it.
    const ai1 = createAgentOS({
      root,
      modelClient: fixedUsageClient(200),
      governor: { budgetTokens: 400, prepareAt: 0.9, windowMs, clock: () => t0 },
    });
    const stopped = await ai1.runGoverned('do a\nand then do b\nand then do c');
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.remaining.length, 1);

    // Session 2 (fresh process, same physical root) BEFORE the window resets.
    const early = createAgentOS({
      root,
      modelClient: fixedUsageClient(200),
      governor: { budgetTokens: 400, windowMs, clock: () => t0 + 60_000 },
    });
    const notYet = await early.resumeGoverned();
    assert.equal(notYet.resumed, false);
    assert.ok(notYet.msRemaining > 0, 'reports time remaining, does not resume early');

    // Session 3 AFTER the window resets → restores and continues the last subtask.
    const later = createAgentOS({
      root,
      modelClient: fixedUsageClient(200),
      governor: { budgetTokens: 400, windowMs, clock: () => t0 + windowMs + 1000 },
    });
    const done = await later.resumeGoverned();
    assert.equal(done.resumed, true);
    assert.equal(done.status, 'completed');
    assert.deepEqual(done.completed.slice(-1), ['and then do c'], 'continued the checkpointed subtask');
    assert.equal(later.governor.hasPendingResume(), false, 'resume checkpoint cleared');
  } finally {
    cleanup(root);
  }
});

test('the window auto-rolls once its reset time has passed', () => {
  const root = tmpRoot();
  try {
    let now = 5_000_000;
    const windowMs = 100_000;
    const g = new UsageGovernor({ paths: { root } }, { budgetTokens: 1000, windowMs, clock: () => now });
    g.record(900); // 90%
    assert.equal(g.status().phase, 'prepare');
    now += windowMs + 1; // window has reset
    g.record(50); // triggers a fresh window, then adds 50
    const s = g.status();
    assert.equal(s.tokensUsed, 50, 'token count reset with the new window');
    assert.equal(s.phase, 'normal');
  } finally {
    cleanup(root);
  }
});
