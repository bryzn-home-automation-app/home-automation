'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createAgentOS } = require('../src/index');
const { tmpRoot, cleanup, mockModelClient } = require('./helpers');

test('routes subtasks to the best-fit specialist', async () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root, modelClient: mockModelClient() });
    a.memory.remember({ tier: 'semantic', content: 'The API lives in backend/src/main/java.', tags: ['backend'] });

    const result = await a.run('implement a fix for the login bug\nand then verify the change with a regression check');
    assert.equal(result.subtasks.length, 2);
    const roles = result.results.map((r) => r.role);
    assert.ok(roles.includes('Engineering'), 'first subtask -> Engineering');
    assert.ok(roles.includes('QA'), 'second subtask -> QA');
  } finally {
    cleanup(root);
  }
});

test('measurement summary reports token savings across a run', async () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root, modelClient: mockModelClient() });
    for (let i = 0; i < 20; i++) {
      a.memory.remember({ tier: 'semantic', content: `Fact number ${i} about the codebase and its many modules.`, tags: ['code'] });
    }
    const result = await a.run('research how the code modules fit together');
    assert.ok(result.summary.tasks >= 1);
    assert.ok(result.summary.baselineTokens >= result.summary.actualTokens);
    assert.ok(result.summary.reductionPct >= 0);
  } finally {
    cleanup(root);
  }
});

test('guardrail: needsApproval blocks a task when approver denies', async () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({
      root,
      modelClient: mockModelClient(),
      orchestrator: {
        needsApproval: (task) => /deploy/i.test(task.goal),
        approver: async () => false, // deny
      },
    });
    const result = await a.run('deploy to production');
    assert.equal(result.results[0].skipped, 'approval denied');
  } finally {
    cleanup(root);
  }
});

test('consolidation records an episode after each task', async () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root, modelClient: mockModelClient() });
    a.memory.remember({ tier: 'semantic', content: 'Weather enrichment table is weather_observations.', tags: ['weather'] });
    const before = a.memory.stats().episodic;
    await a.run('research the weather enrichment table');
    const after = a.memory.stats().episodic;
    assert.equal(after, before + 1, 'one episode consolidated');
  } finally {
    cleanup(root);
  }
});
