'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createAgentOS } = require('../src/index');
const { tmpRoot, cleanup } = require('./helpers');

test('remember persists across instances (physical memory)', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    a.memory.remember({ tier: 'semantic', content: 'Postgres runs on port 5432' });
    // A fresh instance pointed at the same root sees the same memory.
    const b = createAgentOS({ root });
    const all = b.memory.all('semantic');
    assert.equal(all.length, 1);
    assert.match(all[0].content, /5432/);
    assert.ok(all[0].keywords.includes('postgres'));
  } finally {
    cleanup(root);
  }
});

test('rejects unknown tier and empty content', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    assert.throws(() => a.memory.remember({ tier: 'nope', content: 'x' }), /Unknown memory tier/);
    assert.throws(() => a.memory.remember({ tier: 'semantic', content: '   ' }), /content is required/);
  } finally {
    cleanup(root);
  }
});

test('working memory is pruned by TTL on decay', async () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root, workingTtlMs: 5 });
    a.memory.remember({ tier: 'working', content: 'scratch note about the current task' });
    assert.equal(a.memory.stats().working, 1);
    // Let the 5ms TTL elapse so the record is genuinely expired.
    await new Promise((r) => setTimeout(r, 20));
    const { pruned } = a.memory.decay();
    assert.equal(pruned, 1);
    assert.equal(a.memory.stats().working, 0);
  } finally {
    cleanup(root);
  }
});

test('touch increases access count and salience is clamped', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    const rec = a.memory.remember({ tier: 'semantic', content: 'fact about weather', salience: 2 });
    assert.equal(rec.salience, 1); // clamped to 1
    a.memory.touch([rec.id]);
    const after = a.memory.all('semantic')[0];
    assert.equal(after.accessCount, 1);
  } finally {
    cleanup(root);
  }
});
