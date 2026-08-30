'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fileScheduler, readResumeRequest, clearResumeRequest, callbackScheduler } = require('../src/index');
const { tmpRoot, cleanup } = require('./helpers');

test('fileScheduler writes a resume request the waker can read', async () => {
  const root = tmpRoot();
  try {
    const file = path.join(root, 'resume-request.json');
    const sched = fileScheduler(file, { command: 'agent-os governor resume' });
    const resumeAt = Date.parse('2026-08-30T22:00:00Z');
    const info = await sched(resumeAt, { remaining: ['finish part two'] });

    assert.equal(info.scheduledVia, 'file');
    const req = readResumeRequest(file);
    assert.equal(req.resumeAt, '2026-08-30T22:00:00.000Z');
    assert.equal(req.command, 'agent-os governor resume');
    assert.deepEqual(req.payload.remaining, ['finish part two']);

    clearResumeRequest(file);
    assert.equal(fs.existsSync(file), false);
    assert.equal(readResumeRequest(file), null);
  } finally {
    cleanup(root);
  }
});

test('callbackScheduler forwards to a host function', async () => {
  const calls = [];
  const sched = callbackScheduler(async (resumeAt, payload) => { calls.push({ resumeAt, payload }); return 'trigger-123'; });
  const out = await sched(1000, { x: 1 });
  assert.equal(out.scheduledVia, 'callback');
  assert.equal(out.info, 'trigger-123');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload, { x: 1 });
});

test('governor.prepareStop invokes the file scheduler end to end', async () => {
  const root = tmpRoot();
  try {
    const { createAgentOS } = require('../src/index');
    const file = path.join(root, 'resume-request.json');
    const t0 = 1_000_000;
    const ai = createAgentOS({
      root,
      modelClient: async () => ({ text: 'ok', usage: { inputTokens: 200, outputTokens: 0 } }),
      governor: { budgetTokens: 400, windowMs: 5 * 3600 * 1000, clock: () => t0, scheduler: fileScheduler(file) },
    });
    const out = await ai.runGoverned('a\nand then b\nand then c');
    assert.equal(out.status, 'stopped');
    const req = readResumeRequest(file);
    assert.ok(req, 'a resume request file was written');
    assert.equal(new Date(req.resumeAt).getTime(), t0 + 5 * 3600 * 1000);
  } finally {
    cleanup(root);
  }
});
