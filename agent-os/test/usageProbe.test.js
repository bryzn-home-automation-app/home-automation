'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseRateLimitHeaders, HeaderUsageTracker, fileUsageProbe } = require('../src/index');
const { createAgentOS } = require('../src/index');
const { tmpRoot, cleanup } = require('./helpers');

test('parses fraction and reset from remaining/limit headers', () => {
  const headers = {
    'anthropic-ratelimit-unified-remaining': '2000',
    'anthropic-ratelimit-unified-limit': '10000',
    'anthropic-ratelimit-unified-reset': '2026-08-30T22:00:00Z',
  };
  const p = parseRateLimitHeaders(headers);
  assert.equal(p.fraction, 0.8);
  assert.equal(p.resetAt, '2026-08-30T22:00:00.000Z');
});

test('reads a Headers-like object and handles seconds-until-reset', () => {
  const now = Date.parse('2026-08-30T20:00:00Z');
  const headers = new Map([
    ['anthropic-ratelimit-tokens-remaining', '500'],
    ['anthropic-ratelimit-tokens-limit', '1000'],
    ['anthropic-ratelimit-tokens-reset', '3600'], // 1h from now
  ]);
  const p = parseRateLimitHeaders({ get: (k) => headers.get(k) }, { now });
  assert.equal(p.fraction, 0.5);
  assert.equal(p.resetAt, '2026-08-30T21:00:00.000Z');
});

test('maps unified status to a fraction when no counts are present', () => {
  assert.equal(parseRateLimitHeaders({ 'anthropic-ratelimit-unified-status': 'rejected' }).fraction, 1);
  assert.equal(parseRateLimitHeaders({ 'anthropic-ratelimit-unified-status': 'allowed_warning' }).fraction, 0.9);
});

test('returns null when no usable headers are present', () => {
  assert.equal(parseRateLimitHeaders({ 'x-other': '1' }), null);
});

test('HeaderUsageTracker.wrap captures headers and drives the governor probe', async () => {
  const root = tmpRoot();
  try {
    const tracker = new HeaderUsageTracker();
    const rawClient = async () => ({
      text: 'ok',
      usage: { inputTokens: 10, outputTokens: 5 },
      headers: {
        'anthropic-ratelimit-unified-remaining': '50',
        'anthropic-ratelimit-unified-limit': '1000',
        'anthropic-ratelimit-unified-reset': '2026-08-30T22:00:00Z',
      },
    });
    const ai = createAgentOS({
      root,
      modelClient: tracker.wrap(rawClient),
      governor: { usageProbe: tracker.probe() },
    });
    // Before any call, probe has no reading → governor self-tracks (normal).
    assert.equal(ai.governor.status().phase, 'normal');
    await ai.run('do something small');
    // After a call, the probe reports 95% used → prepare.
    assert.equal(ai.governor.usageFraction(), 0.95);
    assert.equal(ai.governor.status().phase, 'prepare');
  } finally {
    cleanup(root);
  }
});

test('fileUsageProbe reads a hook-written file and ignores stale ones', () => {
  const root = tmpRoot();
  try {
    const f = path.join(root, 'usage.json');
    fs.writeFileSync(f, JSON.stringify({ fraction: 0.83, resetAt: '2026-08-30T22:00:00Z' }));
    const probe = fileUsageProbe(f);
    assert.equal(probe().fraction, 0.83);

    // A stale file (older than maxAge) is ignored.
    const stale = fileUsageProbe(f, { maxAgeMs: -1 });
    assert.equal(stale(), null);

    // Missing file → null.
    assert.equal(fileUsageProbe(path.join(root, 'nope.json'))(), null);
  } finally {
    cleanup(root);
  }
});
