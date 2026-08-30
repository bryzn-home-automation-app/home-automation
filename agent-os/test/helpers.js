'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/** Create an isolated temp physical-memory root for a test. */
function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-test-'));
}

function cleanup(root) {
  try {
    fs.rmSync(root, { recursive: true, force: true });
  } catch (_) {
    /* best effort */
  }
}

/** A deterministic mock model client: echoes token counts, no network. */
function mockModelClient() {
  return async ({ messages }) => {
    const inputTokens = messages.reduce((n, m) => n + Math.ceil((m.content || '').length / 4), 0);
    return {
      text: `handled with ${messages.length} messages`,
      usage: { inputTokens, outputTokens: 12 },
    };
  };
}

module.exports = { tmpRoot, cleanup, mockModelClient };
