'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createAgentOS } = require('../src/index');
const { tmpRoot, cleanup, mockModelClient } = require('./helpers');

test('weekly review reports what each bot ran, produced, and skipped', async () => {
  const root = tmpRoot();
  try {
    const ai = createAgentOS({
      root,
      modelClient: mockModelClient(),
      approvalByReversibility: true,
      orchestrator: { approver: async () => false },
    });
    ai.memory.remember({ tier: 'semantic', content: 'The sync writes rows to Postgres append-only.', tags: ['sync'] });

    await ai.run('research how the sync writes to the database'); // Research runs
    await ai.run('delete all the old usage rows');                 // Engineering task, blocked by guard

    const report = ai.review.weekly();
    assert.ok(report.totals.tasksRun >= 1);
    const research = report.agents.find((a) => a.agent === 'research');
    assert.ok(research && research.ran >= 1, 'research ran at least once');
    // The skipped (approval-denied) task shows up somewhere in the review.
    const anySkipped = report.agents.some((a) => a.skipped.length > 0);
    assert.ok(anySkipped, 'a skipped task is reported');

    const text = ai.review.render(report);
    assert.match(text, /Weekly review/);
  } finally {
    cleanup(root);
  }
});

test('routines that did not fire are flagged as prune candidates', async () => {
  const root = tmpRoot();
  try {
    const ai = createAgentOS({ root, modelClient: mockModelClient() });
    ai.routines.register({ name: 'Never fired', request: 'do a thing' });
    const fired = ai.routines.register({ name: 'Fired once', request: 'research a thing' });
    await ai.routines.run(fired.id);

    const report = ai.review.weekly();
    assert.ok(report.totals.pruneCandidates.includes('Never fired'));
    assert.ok(!report.totals.pruneCandidates.includes('Fired once'));
  } finally {
    cleanup(root);
  }
});
