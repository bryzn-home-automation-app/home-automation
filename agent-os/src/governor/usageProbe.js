'use strict';

const fs = require('fs');

/**
 * Usage probes for the Usage Governor.
 *
 * On a Claude Code / Max subscription, the live 5-hour-window signal rides on the
 * `anthropic-ratelimit-*` response headers of the subscription's own API traffic
 * (the same headers Claude Code reads to show its usage warnings). This module
 * turns those headers into the `{ fraction, resetAt }` shape the governor's
 * `usageProbe` expects — and, for the common case where Claude Code (not this
 * toolkit) makes the calls, a file-based probe an external hook can feed.
 *
 * The exact unified-window header names are not in the public API docs, so the
 * parser is name-agnostic: it tries a prioritized list of candidates and also
 * lets you pass your own via `headerNames`. It returns the `raw` headers it saw
 * so you can confirm which ones your account actually sends.
 */

const DEFAULT_HEADER_NAMES = {
  status: ['anthropic-ratelimit-unified-status', 'anthropic-ratelimit-unified-5h-status'],
  remaining: [
    'anthropic-ratelimit-unified-remaining',
    'anthropic-ratelimit-unified-5h-remaining',
    'anthropic-ratelimit-tokens-remaining',
    'anthropic-ratelimit-requests-remaining',
  ],
  limit: [
    'anthropic-ratelimit-unified-limit',
    'anthropic-ratelimit-unified-5h-limit',
    'anthropic-ratelimit-tokens-limit',
    'anthropic-ratelimit-requests-limit',
  ],
  reset: [
    'anthropic-ratelimit-unified-reset',
    'anthropic-ratelimit-unified-5h-reset',
    'anthropic-ratelimit-tokens-reset',
    'anthropic-ratelimit-requests-reset',
  ],
};

/** Read a header value from a Headers-like object or a plain object (case-insensitive). */
function getHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) return headers[k];
  return null;
}

function firstHeader(headers, names) {
  for (const n of names) {
    const v = getHeader(headers, n);
    if (v != null && v !== '') return { name: n, value: v };
  }
  return null;
}

/** Parse a reset value that may be an RFC3339 timestamp or seconds-until-reset. */
function parseReset(value, now = Date.now()) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    // Bare number → seconds until reset (small) or epoch seconds (large).
    const n = Number(s);
    return n > 1e6 ? new Date(n * 1000).toISOString() : new Date(now + n * 1000).toISOString();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Turn API response headers into a governor usage reading.
 * @returns {{ fraction:number|null, resetAt:?string, remaining:?number, limit:?number, status:?string, source:?string, raw:object }|null}
 */
function parseRateLimitHeaders(headers, opts = {}) {
  const names = { ...DEFAULT_HEADER_NAMES, ...(opts.headerNames || {}) };
  const now = opts.now || Date.now();

  const statusHit = firstHeader(headers, names.status);
  const remainingHit = firstHeader(headers, names.remaining);
  const limitHit = firstHeader(headers, names.limit);
  const resetHit = firstHeader(headers, names.reset);

  const status = statusHit ? String(statusHit.value).toLowerCase() : null;
  const remaining = remainingHit ? Number(remainingHit.value) : null;
  const limit = limitHit ? Number(limitHit.value) : null;
  const resetAt = resetHit ? parseReset(resetHit.value, now) : null;

  let fraction = null;
  if (limit != null && limit > 0 && remaining != null && !Number.isNaN(remaining)) {
    fraction = Math.min(1, Math.max(0, 1 - remaining / limit));
  } else if (status === 'rejected') {
    fraction = 1; // fully consumed
  } else if (status === 'allowed_warning') {
    fraction = 0.9; // warning band — treat as prepare threshold
  }

  // Nothing usable found → return null so the governor keeps self-tracking.
  if (fraction == null && resetAt == null) return null;

  const raw = {};
  for (const hit of [statusHit, remainingHit, limitHit, resetHit]) if (hit) raw[hit.name] = hit.value;
  return { fraction, resetAt, remaining, limit, status, source: (remainingHit || statusHit || {}).name, raw };
}

/**
 * Captures rate-limit headers from a real modelClient's responses so the
 * governor can probe the latest reading. Wrap your SDK-backed modelClient — it
 * must return `headers` alongside `{ text, usage }` (e.g. from the SDK's
 * `.withResponse()`), and the tracker exposes `.probe()` for the governor.
 */
class HeaderUsageTracker {
  constructor(opts = {}) {
    this.opts = opts;
    this.latest = null;
  }

  update(headers) {
    const parsed = parseRateLimitHeaders(headers, this.opts);
    if (parsed) this.latest = parsed;
    return parsed;
  }

  /** Wrap a modelClient so every call feeds the tracker. */
  wrap(modelClient) {
    return async (args) => {
      const res = await modelClient(args);
      if (res && res.headers) this.update(res.headers);
      return res;
    };
  }

  /** The governor usageProbe: () => { fraction, resetAt } | null. */
  probe() {
    return () => (this.latest ? { fraction: this.latest.fraction, resetAt: this.latest.resetAt } : null);
  }
}

/**
 * File-based probe for when Claude Code (not this toolkit) makes the calls: an
 * external hook writes `{ "fraction": 0.83, "resetAt": "..." }` to a small JSON
 * file (e.g. from `claude usage` output or an OTEL export), and the governor
 * reads it. Missing/stale file → returns null (governor self-tracks instead).
 */
function fileUsageProbe(filePath, opts = {}) {
  const maxAgeMs = opts.maxAgeMs || 5 * 60 * 1000;
  return () => {
    try {
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs > maxAgeMs) return null; // stale
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && (data.fraction != null || data.resetAt)) {
        return { fraction: data.fraction, resetAt: data.resetAt };
      }
    } catch (_) {
      /* no file / bad json → self-track */
    }
    return null;
  };
}

module.exports = { parseRateLimitHeaders, HeaderUsageTracker, fileUsageProbe, parseReset, DEFAULT_HEADER_NAMES };
