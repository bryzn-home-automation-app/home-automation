'use strict';

const path = require('path');
const fs = require('fs');

/**
 * Configuration for an Agent OS instance.
 *
 * Everything is resolved relative to a `root` directory (the "physical memory"
 * location). By default this is `<cwd>/.agent-os`, which makes the whole system
 * portable: drop it into any repo and it keeps that repo's memory beside it,
 * without touching a database or global state.
 *
 * A project may override any of this via an `.agent-os/config.json` file or via
 * the options passed to `createAgentOS()`.
 */

const DEFAULT_MODEL_PRICING = {
  // USD per 1M tokens. Values are configurable; these are placeholders you can
  // update to match current published pricing for your target model.
  'claude-opus': { input: 15.0, output: 75.0 },
  'claude-sonnet': { input: 3.0, output: 15.0 },
  'claude-haiku': { input: 0.8, output: 4.0 },
  default: { input: 3.0, output: 15.0 },
};

const DEFAULTS = {
  // Where physical memory lives.
  root: null, // resolved lazily to <cwd>/.agent-os
  // Token budget the Context Compiler is allowed to spend assembling context
  // for a single task (excludes the model's own reasoning/output budget).
  contextTokenBudget: 4000,
  // Per-tier retrieval weights (multiplied into the relevance score).
  tierWeights: {
    semantic: 1.0,
    project: 1.1,
    preference: 1.2,
    procedural: 0.9,
    episodic: 0.8,
    working: 1.3,
  },
  // How strongly recency boosts a record (0 disables recency weighting).
  recencyHalfLifeDays: 30,
  // Model used for cost math + (optionally) the live model client.
  model: 'claude-sonnet',
  pricing: DEFAULT_MODEL_PRICING,
  // Working-memory time-to-live in ms (records older than this are pruned).
  workingTtlMs: 1000 * 60 * 60 * 6, // 6 hours
  // Memory admission policy — what is allowed to become durable memory.
  // "Would retrieving this later materially improve an agent's ability to
  //  perform a task?" If not, it stays episodic or is discarded.
  policy: {
    minWords: 4, // shorter than this reads as filler
    minKeywords: 2, // durable facts need at least this much substance
    hedgeDensity: 0.12, // hedge words / total words above this = speculation
    minConfidence: 0.5, // explicit candidate.confidence below this = speculation
    dedupeJaccard: 0.85, // keyword overlap at/above this = duplicate fact
    promoteThreshold: 2, // materiality score needed to promote to a durable tier
  },
};

const TIERS = ['semantic', 'episodic', 'procedural', 'project', 'preference', 'working'];

function resolveConfig(options = {}) {
  const cwd = options.cwd || process.cwd();
  const root = path.resolve(options.root || DEFAULTS.root || path.join(cwd, '.agent-os'));

  // Layer: DEFAULTS < on-disk config.json < explicit options.
  let fileConfig = {};
  const configPath = path.join(root, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (_) {
    /* ignore malformed config, fall back to defaults */
  }

  const merged = {
    ...DEFAULTS,
    ...fileConfig,
    ...options,
    root,
    tierWeights: { ...DEFAULTS.tierWeights, ...(fileConfig.tierWeights || {}), ...(options.tierWeights || {}) },
    pricing: { ...DEFAULT_MODEL_PRICING, ...(fileConfig.pricing || {}), ...(options.pricing || {}) },
    policy: { ...DEFAULTS.policy, ...(fileConfig.policy || {}), ...(options.policy || {}) },
  };

  merged.paths = {
    root,
    memory: path.join(root, 'memory'),
    skills: path.join(root, 'skills'),
    runs: path.join(root, 'runs'),
    measurements: path.join(root, 'measurements.jsonl'),
  };

  return merged;
}

module.exports = { resolveConfig, DEFAULTS, TIERS, DEFAULT_MODEL_PRICING };
