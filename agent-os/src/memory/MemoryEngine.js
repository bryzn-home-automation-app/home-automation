'use strict';

const { FileStore } = require('./store');
const { shortId, contentHash } = require('../util/id');
const { TIERS } = require('../config');
const log = require('../util/logger');

/**
 * The Memory Engine is the "physical memory" of the Agent OS: durable storage
 * that lives *outside* the model's context window. Memory can be large; context
 * should be small. The model is never treated as the database.
 *
 * Six tiers, each a distinct kind of knowledge:
 *   - semantic:   durable facts about the world/codebase ("Postgres is on 5432")
 *   - episodic:   time-stamped events / history ("sync failed on 2026-08-30")
 *   - procedural: how-to knowledge, usually pointers to skills
 *   - project:    project-scoped state & decisions
 *   - preference: user/operator preferences
 *   - working:    ephemeral scratch for the current task (TTL-pruned)
 *
 * A memory record:
 *   {
 *     id, tier, content, keywords[], tags[], source,
 *     salience (0..1), key (optional conflict key), refs[], meta{},
 *     createdAt, updatedAt, accessedAt, accessCount
 *   }
 */
class MemoryEngine {
  constructor(config) {
    this.config = config;
    this.store = new FileStore(config.paths.memory);
  }

  static tiers() {
    return [...TIERS];
  }

  _now() {
    return new Date().toISOString();
  }

  /**
   * Write a memory. Deterministic keywords are extracted from content when not
   * provided, so retrieval works even for records added programmatically.
   */
  remember(input) {
    const tier = input.tier || 'semantic';
    if (!TIERS.includes(tier)) {
      throw new Error(`Unknown memory tier "${tier}". Valid: ${TIERS.join(', ')}`);
    }
    const content = String(input.content || '').trim();
    if (!content) throw new Error('MemoryEngine.remember: content is required');

    const now = this._now();
    const record = {
      id: shortId('mem'),
      tier,
      content,
      keywords: input.keywords && input.keywords.length ? input.keywords : extractKeywords(content),
      tags: input.tags || [],
      source: input.source || 'unknown',
      salience: clamp01(input.salience != null ? input.salience : 0.5),
      key: input.key || null,
      refs: input.refs || [],
      meta: input.meta || {},
      hash: contentHash(content),
      createdAt: now,
      updatedAt: now,
      accessedAt: now,
      accessCount: 0,
    };
    this.store.append(tier, record);
    log.debug(`remember [${tier}] ${record.id}`);
    return record;
  }

  /**
   * Admission-gated write. Runs the candidate through the MemoryPolicy and only
   * then decides whether to promote it to a durable tier, downgrade it to
   * episodic history, or discard it. This is the path Claude output should take;
   * `remember()` stays the unconditional low-level write for deliberate inserts.
   *
   * @returns {{ decision, tier, reasons, materiality, record }}
   */
  consider(candidate, options = {}) {
    if (!this._policy) {
      const { MemoryPolicy } = require('./MemoryPolicy');
      this._policy = new MemoryPolicy(this.config, this.config.policyOptions || {});
    }
    const verdict = this._policy.evaluate(candidate, {
      existingDurable: options.existingDurable || this._durableRecords(),
    });
    let record = null;
    if (verdict.decision !== 'discard') {
      record = this.remember({ ...candidate, tier: verdict.tier });
    }
    return { ...verdict, record };
  }

  _durableRecords() {
    const { DURABLE_TIERS } = require('./MemoryPolicy');
    return [...DURABLE_TIERS].flatMap((t) => this.store.read(t));
  }

  /** Read all records for a tier (or every tier when omitted). */
  all(tier) {
    if (tier) return this.store.read(tier);
    return TIERS.flatMap((t) => this.store.read(t));
  }

  /** Update salience/content/tags of an existing record in place. */
  update(id, patch) {
    for (const tier of TIERS) {
      const records = this.store.read(tier);
      const idx = records.findIndex((r) => r.id === id);
      if (idx !== -1) {
        const rec = records[idx];
        Object.assign(rec, patch, { updatedAt: this._now() });
        if (patch.salience != null) rec.salience = clamp01(patch.salience);
        if (patch.content) rec.hash = contentHash(rec.content);
        records[idx] = rec;
        this.store.replace(tier, records);
        return rec;
      }
    }
    return null;
  }

  /** Mark records as accessed (drives usage-based salience). */
  touch(ids) {
    const set = new Set(ids);
    for (const tier of TIERS) {
      const records = this.store.read(tier);
      let changed = false;
      for (const r of records) {
        if (set.has(r.id)) {
          r.accessedAt = this._now();
          r.accessCount = (r.accessCount || 0) + 1;
          changed = true;
        }
      }
      if (changed) this.store.replace(tier, records);
    }
  }

  /**
   * Salience decay + working-memory TTL pruning. Called periodically (and by
   * the consolidator) so stale knowledge naturally sinks and expires.
   */
  decay({ rate = 0.98, floor = 0.02 } = {}) {
    const cutoff = Date.now() - this.config.workingTtlMs;
    let pruned = 0;
    for (const tier of TIERS) {
      let records = this.store.read(tier);
      if (tier === 'working') {
        const before = records.length;
        records = records.filter((r) => new Date(r.createdAt).getTime() >= cutoff);
        pruned += before - records.length;
      }
      for (const r of records) {
        // Records accessed recently decay slower.
        const boost = Math.min(0.02 * (r.accessCount || 0), 0.1);
        r.salience = clamp01(Math.max(floor, r.salience * rate + boost * (1 - rate)));
      }
      this.store.replace(tier, records);
    }
    log.debug(`decay complete, pruned ${pruned} working records`);
    return { pruned };
  }

  stats() {
    const out = {};
    for (const tier of TIERS) out[tier] = this.store.read(tier).length;
    out.total = Object.values(out).reduce((a, b) => a + b, 0);
    return out;
  }
}

const STOPWORDS = new Set(
  ('a an the and or but if then else of to in on at for with without by from as is are was were be been ' +
    'being do does did done this that these those it its it\'s we you i they he she them us our your their ' +
    'not no yes can will would should could may might must about into over under out up down off than too very')
    .split(/\s+/)
);

/** Deterministic keyword extraction: lowercased, de-stopworded, unique. */
function extractKeywords(text, max = 24) {
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9_.\-\s/]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

function clamp01(n) {
  if (Number.isNaN(n) || n == null) return 0;
  return Math.max(0, Math.min(1, n));
}

module.exports = { MemoryEngine, extractKeywords };
