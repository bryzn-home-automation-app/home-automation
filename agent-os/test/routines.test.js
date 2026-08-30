'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createAgentOS } = require('../src/index');
const { tmpRoot, cleanup, mockModelClient } = require('./helpers');

test('register a routine and run it via the orchestrator', async () => {
  const root = tmpRoot();
  try {
    const ai = createAgentOS({ root, modelClient: mockModelClient() });
    const r = ai.routines.register({ name: 'Daily research', request: 'research the codebase modules', schedule: { intervalMs: 1000 } });
    const entry = await ai.routines.run(r.id);
    assert.equal(entry.status, 'ok');
    assert.ok(entry.produced);
    assert.equal(ai.routines.get(r.id).runCount, 1);
    // Fresh instance re-hydrates routines from disk.
    const b = createAgentOS({ root, modelClient: mockModelClient() });
    assert.equal(b.routines.list().length, 1);
  } finally {
    cleanup(root);
  }
});

test('schedule due-ness respects the interval', async () => {
  const root = tmpRoot();
  try {
    const ai = createAgentOS({ root, modelClient: mockModelClient() });
    const r = ai.routines.register({ name: 'Every minute', request: 'research things', schedule: { intervalMs: 60000 } });
    const t0 = Date.now();
    assert.equal(ai.routines.due(t0).length, 1, 'never-run routine is due');
    await ai.routines.run(r.id);
    assert.equal(ai.routines.due(Date.now()).length, 0, 'not due right after running');
    assert.equal(ai.routines.due(Date.now() + 61000).length, 1, 'due again after the interval');
  } finally {
    cleanup(root);
  }
});

test('trigger events fire matching routines', async () => {
  const root = tmpRoot();
  try {
    const ai = createAgentOS({ root, modelClient: mockModelClient() });
    ai.routines.register({ name: 'On push', request: 'verify the build', trigger: 'git.push' });
    assert.equal(ai.routines.due(Date.now(), { event: 'git.push' }).length, 1);
    assert.equal(ai.routines.due(Date.now(), { event: 'other.event' }).length, 0);
    const ran = await ai.routines.runDue(Date.now(), { event: 'git.push' });
    assert.equal(ran.length, 1);
  } finally {
    cleanup(root);
  }
});

test('a learned skill can be promoted to a routine', async () => {
  const root = tmpRoot();
  try {
    const ai = createAgentOS({ root, modelClient: mockModelClient() });
    const skill = ai.skills.learnFromDemonstration({
      name: 'Sync check',
      steps: [{ action: 'POST /api/admin/sync/daily' }, { action: 'assert row' }],
      triggers: ['sync'],
    });
    const routine = ai.routines.fromSkill(skill.id, { name: 'Nightly sync', schedule: { intervalMs: 86400000 } });
    const seen = [];
    const entry = await ai.routines.run(routine.id, { stepRunner: async (s) => { seen.push(s.action); return 'ok'; } });
    assert.equal(entry.status, 'ok');
    assert.deepEqual(seen, ['POST /api/admin/sync/daily', 'assert row']);
  } finally {
    cleanup(root);
  }
});

test('prune removes a routine you would not miss', () => {
  const root = tmpRoot();
  try {
    const ai = createAgentOS({ root });
    const r = ai.routines.register({ name: 'Unused', request: 'do nothing useful' });
    assert.equal(ai.routines.list().length, 1);
    assert.equal(ai.routines.prune(r.id), true);
    assert.equal(ai.routines.list().length, 0);
  } finally {
    cleanup(root);
  }
});
