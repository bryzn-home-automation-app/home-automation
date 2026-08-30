'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createAgentOS } = require('../src/index');
const { MemoryPolicy, REASON } = require('../src/memory/MemoryPolicy');
const { tmpRoot, cleanup } = require('./helpers');

function policy() {
  return new MemoryPolicy({});
}

test('promotes a concrete, material fact to its durable tier', () => {
  const v = policy().evaluate({ tier: 'semantic', content: 'The backend runs on port 8080 and stores usage rows in Postgres.' });
  assert.equal(v.decision, 'promote');
  assert.equal(v.tier, 'semantic');
  assert.ok(v.materiality >= 2);
});

test('discards conversational filler', () => {
  for (const content of ['Thanks!', 'Got it, sounds good', 'ok']) {
    const v = policy().evaluate({ tier: 'semantic', content });
    assert.equal(v.decision, 'discard', `expected discard for "${content}"`);
    assert.ok(v.reasons.includes(REASON.FILLER));
  }
});

test('downgrades temporary reasoning to episodic history', () => {
  const v = policy().evaluate({
    tier: 'semantic',
    content: 'Let me check the sync scheduler configuration and see what the retry window is.',
  });
  assert.equal(v.decision, 'episodic');
  assert.ok(v.reasons.includes(REASON.REASONING));
});

test('downgrades low-confidence speculation to episodic', () => {
  const v = policy().evaluate({
    tier: 'semantic',
    content: 'It might be that the token maybe expires, probably after a while, I think.',
  });
  assert.equal(v.decision, 'episodic');
  assert.ok(v.reasons.includes(REASON.SPECULATION));
});

test('respects an explicit low confidence score', () => {
  const v = policy().evaluate({
    tier: 'project',
    content: 'The deploy target is the NUC host via the deploy-nuc alias.',
    confidence: 0.2,
  });
  assert.equal(v.decision, 'episodic');
  assert.ok(v.reasons.includes(REASON.SPECULATION));
});

test('downgrades stale task state', () => {
  const v = policy().evaluate({
    tier: 'project',
    content: 'Currently working on the hourly sync; next step is to add the aggregation and I still need to test it.',
  });
  assert.equal(v.decision, 'episodic');
  assert.ok(v.reasons.includes(REASON.STALE_STATE));
});

test('discards a duplicate of an existing durable fact', () => {
  const existing = [{ id: 'mem_1', content: 'Postgres runs on port 5432 for usage data.', keywords: ['postgres', 'runs', 'port', '5432', 'usage', 'data'] }];
  const v = policy().evaluate(
    { tier: 'semantic', content: 'Postgres runs on port 5432 for usage data.' },
    { existingDurable: existing }
  );
  assert.equal(v.decision, 'discard');
  assert.ok(v.reasons.includes(REASON.DUPLICATE));
  assert.equal(v.duplicateOf, 'mem_1');
});

test('episodic/working targets face only the filler bar', () => {
  const p = policy();
  // Substantive-but-transient content is fine in episodic.
  const ok = p.evaluate({ tier: 'episodic', content: 'Let me check the logs for the failed run.' });
  assert.equal(ok.decision, 'promote');
  assert.equal(ok.tier, 'episodic');
  // Filler is still discarded even for episodic.
  const filler = p.evaluate({ tier: 'working', content: 'ok' });
  assert.equal(filler.decision, 'discard');
});

test('a keyed fact is durable even when terse', () => {
  const v = policy().evaluate({ tier: 'project', content: 'Deploy via deploy-nuc alias.', key: 'deploy.target' });
  assert.equal(v.decision, 'promote');
});

test('MemoryEngine.consider writes only admitted memories', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    const promoted = a.memory.consider({ tier: 'semantic', content: 'The API gateway is nginx on port 80 in front of the SPA.' });
    assert.equal(promoted.decision, 'promote');
    assert.ok(promoted.record);

    const discarded = a.memory.consider({ tier: 'semantic', content: 'Thanks, will do!' });
    assert.equal(discarded.decision, 'discard');
    assert.equal(discarded.record, null);

    const downgraded = a.memory.consider({ tier: 'semantic', content: 'Let me go look at the scheduler code next.' });
    assert.equal(downgraded.decision, 'episodic');
    assert.equal(downgraded.record.tier, 'episodic');

    // Durable memory holds only the one real fact.
    assert.equal(a.memory.stats().semantic, 1);
    assert.equal(a.memory.stats().episodic, 1);
  } finally {
    cleanup(root);
  }
});

test('host classifier can override the heuristic', () => {
  const p = new MemoryPolicy({}, {
    classifier: (candidate) => (/secret/i.test(candidate.content) ? { decision: 'discard', reasons: ['redacted'] } : null),
  });
  const v = p.evaluate({ tier: 'semantic', content: 'The secret admin token is stored in the vault at /etc/secrets.' });
  assert.equal(v.decision, 'discard');
  assert.ok(v.reasons.includes('redacted'));
});
