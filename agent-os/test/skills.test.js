'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createAgentOS } = require('../src/index');
const { tmpRoot, cleanup } = require('./helpers');

test('learn from demonstration and re-load from disk', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    a.skills.learnFromDemonstration({
      name: 'Run daily sync',
      description: 'Trigger the daily CoServ sync and verify a row landed',
      steps: [
        { action: 'POST /api/admin/sync/daily' },
        { action: 'query electric_usage for yesterday' },
        { action: 'assert row count >= 1' },
      ],
      triggers: ['daily sync', 'coserv'],
    });
    // Fresh instance re-hydrates skills from disk.
    const b = createAgentOS({ root });
    assert.equal(b.skills.list().length, 1);
    const match = b.skills.match('kick off the daily sync please');
    assert.ok(match, 'should match learned skill');
    assert.equal(match.skill.name, 'Run daily sync');
  } finally {
    cleanup(root);
  }
});

test('run executes each step via the provided runner and increments runCount', async () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    const skill = a.skills.learnFromDemonstration({
      name: 'Two step',
      steps: [{ action: 'first' }, { action: 'second' }],
      triggers: ['two step'],
    });
    const seen = [];
    const res = await a.skills.run(skill.id, async (step) => {
      seen.push(step.action);
      return 'ok';
    });
    assert.deepEqual(seen, ['first', 'second']);
    assert.equal(res.steps.length, 2);
    assert.equal(a.skills.get(skill.id).runCount, 1);
  } finally {
    cleanup(root);
  }
});

test('learnFromDemonstration validates input', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    assert.throws(() => a.skills.learnFromDemonstration({ name: 'x' }), /requires/);
  } finally {
    cleanup(root);
  }
});
