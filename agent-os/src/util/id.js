'use strict';

const crypto = require('crypto');

/** Short, sortable-ish unique id: <base36 time>-<random>. */
function shortId(prefix = '') {
  const t = Date.now().toString(36);
  const r = crypto.randomBytes(4).toString('hex');
  return `${prefix ? prefix + '_' : ''}${t}-${r}`;
}

/** Deterministic content hash, used for dedup / conflict keys. */
function contentHash(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 16);
}

module.exports = { shortId, contentHash };
