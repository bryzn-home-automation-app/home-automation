'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createAgentOS, reversibilityGuard, classifyReversibility } = require('../src/index');
const { tmpRoot, cleanup, mockModelClient } = require('./helpers');

test('reversible work is auto-approved; irreversible work waits', () => {
  const guard = reversibilityGuard();
  assert.equal(guard({ goal: 'refactor the sync module and add a test' }), false);
  assert.equal(guard({ goal: 'research how auth works' }), false);
  assert.equal(guard({ goal: 'deploy the backend to production' }), true);
  assert.equal(guard({ goal: 'delete the old usage rows' }), true);
  assert.equal(guard({ goal: 'send the summary email to the team' }), true);
  assert.equal(guard({ goal: 'pay the vendor invoice' }), true);
});

test('classify explains the category and matches', () => {
  const c = classifyReversibility({ goal: 'publish the release notes' });
  assert.equal(c.needsApproval, true);
  assert.equal(c.category, 'external');
  assert.ok(c.matched.includes('publish'));
});

test('charter neverWithoutAsking escalates even without a keyword', () => {
  const guard = reversibilityGuard();
  const agent = { charter: { neverWithoutAsking: ['change public API contracts'] } };
  assert.equal(guard({ goal: 'change the public API contracts for /users' }, agent), true);
  assert.equal(guard({ goal: 'read the public API docs' }, agent), false);
});

test('approvalByReversibility wires the guard into the orchestrator', async () => {
  const root = tmpRoot();
  try {
    const approvals = [];
    const ai = createAgentOS({
      root,
      modelClient: mockModelClient(),
      approvalByReversibility: true,
      orchestrator: { approver: async ({ task }) => { approvals.push(task.goal); return false; } },
    });
    const result = await ai.run('deploy to production');
    assert.equal(result.results[0].skipped, 'approval denied');
    assert.equal(approvals.length, 1);
  } finally {
    cleanup(root);
  }
});
