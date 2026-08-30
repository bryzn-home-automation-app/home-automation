'use strict';

const fs = require('fs');
const path = require('path');
const log = require('../util/logger');

/**
 * Usage Governor — keep long work inside a rolling usage window (e.g. the 5-hour
 * Claude session window) by watching consumption, winding down gracefully as it
 * fills, checkpointing state, and scheduling an automatic resume when the window
 * resets.
 *
 *   < conserve%   → normal    (run freely)
 *   conserve–90%  → conserve  (avoid starting large/irreversible work)
 *   ≥ prepare%    → prepare   → finish safe step → save state → stop gracefully
 *                              → schedule resume → (window reset) → restore → continue
 *
 * The live usage signal is pluggable. By default the governor self-tracks the
 * tokens it is told about (`record`) against `budgetTokens`, so it works with no
 * external meter. If the host CAN read the real percentage (Claude Code surfaces
 * it), inject `usageProbe: () => ({ fraction, resetAt? })` and it takes over.
 *
 * State persists to disk so a resume — which is a brand-new process/session —
 * can restore exactly where the previous one stopped.
 */

const HOUR = 3600 * 1000;

class UsageGovernor {
  constructor(config = {}, options = {}) {
    const g = config.governor || {};
    this.windowMs = options.windowMs || g.windowMs || 5 * HOUR;
    this.budgetTokens = options.budgetTokens || g.budgetTokens || 200000; // per-window token budget
    this.conserveAt = options.conserveAt || g.conserveAt || 0.8;
    this.prepareAt = options.prepareAt || g.prepareAt || 0.9;

    // Pluggable seams (all optional):
    this.usageProbe = options.usageProbe || null;         // () => number | { fraction, resetAt }
    this.scheduler = options.scheduler || null;           // async (resumeAt, payload) => any
    this.clock = options.clock || (() => Date.now());     // injectable for tests

    this.statePath = path.join(config.paths ? config.paths.root : '.', 'governor.json');
    this.resumePath = path.join(config.paths ? config.paths.root : '.', 'governor-resume.json');
    if (config.paths) fs.mkdirSync(config.paths.root, { recursive: true });

    this.state = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
    } catch (_) {
      return { windowStartedAt: this.clock(), tokensUsed: 0, phase: 'normal' };
    }
  }

  _save() {
    try {
      fs.writeFileSync(`${this.statePath}.tmp`, JSON.stringify(this.state, null, 2));
      fs.renameSync(`${this.statePath}.tmp`, this.statePath);
    } catch (err) {
      log.warn(`governor: could not persist state: ${err.message}`);
    }
  }

  /** When the current window resets (rolling from its start). */
  resetAt() {
    if (this.usageProbe) {
      const p = this.usageProbe();
      if (p && typeof p === 'object' && p.resetAt) return new Date(p.resetAt).getTime();
    }
    return this.state.windowStartedAt + this.windowMs;
  }

  /** Fraction of the window consumed, in [0, ∞). */
  usageFraction() {
    if (this.usageProbe) {
      const p = this.usageProbe();
      const f = typeof p === 'number' ? p : p && p.fraction;
      if (f != null) return Math.max(0, f);
    }
    return this.budgetTokens > 0 ? this.state.tokensUsed / this.budgetTokens : 0;
  }

  classify(fraction = this.usageFraction()) {
    if (fraction >= this.prepareAt) return 'prepare';
    if (fraction >= this.conserveAt) return 'conserve';
    return 'normal';
  }

  /** Record tokens consumed by a step. Accepts a number or {inputTokens,outputTokens}. */
  record(usage) {
    let tokens = 0;
    if (typeof usage === 'number') tokens = usage;
    else if (usage) tokens = (usage.inputTokens || 0) + (usage.outputTokens || 0);

    // Auto-roll the window if it has already reset since we last looked.
    if (this.clock() >= this.resetAt()) this.startNewWindow();

    this.state.tokensUsed += tokens;
    this.state.phase = this.classify();
    this._save();
    return this.status();
  }

  status() {
    const fraction = this.usageFraction();
    const phase = this.classify(fraction);
    const resetAt = this.resetAt();
    return {
      fraction: round(fraction, 4),
      phase,
      windowStartedAt: new Date(this.state.windowStartedAt).toISOString(),
      resetAt: new Date(resetAt).toISOString(),
      msUntilReset: Math.max(0, resetAt - this.clock()),
      tokensUsed: this.state.tokensUsed,
      budgetTokens: this.budgetTokens,
      stopped: this.state.phase === 'stopped',
    };
  }

  shouldConserve() {
    return ['conserve', 'prepare'].includes(this.classify());
  }

  shouldPrepare() {
    return this.classify() === 'prepare';
  }

  /** Start a fresh window (called on reset). */
  startNewWindow(at = this.clock()) {
    this.state = { windowStartedAt: at, tokensUsed: 0, phase: 'normal' };
    this._save();
    return this.status();
  }

  /**
   * PREPARE flow: finish-safe-step happens in the caller; this saves the resume
   * state, marks the session stopped, and schedules the resume for window reset.
   *
   * @param {object} checkpoint  arbitrary state to restore on resume (e.g. the
   *                             remaining task queue + any pointers into memory)
   * @returns {{ resumeAt, checkpointPath, scheduled }}
   */
  async prepareStop(checkpoint = {}) {
    const resumeAt = this.resetAt();
    const payload = {
      savedAt: new Date(this.clock()).toISOString(),
      resumeAt: new Date(resumeAt).toISOString(),
      windowStartedAt: new Date(this.state.windowStartedAt).toISOString(),
      checkpoint,
    };
    fs.writeFileSync(this.resumePath, JSON.stringify(payload, null, 2));
    this.state.phase = 'stopped';
    this._save();

    let scheduled = false;
    if (this.scheduler) {
      try {
        await this.scheduler(resumeAt, payload);
        scheduled = true;
      } catch (err) {
        log.warn(`governor: scheduler failed: ${err.message}`);
      }
    }
    log.debug(`governor: prepared stop, resume at ${payload.resumeAt}`);
    return { resumeAt: payload.resumeAt, checkpointPath: this.resumePath, scheduled };
  }

  /** Is there saved work waiting to resume? */
  hasPendingResume() {
    return fs.existsSync(this.resumePath);
  }

  /**
   * RESUME flow. If the window has reset, roll into a fresh window, load the
   * checkpoint, clear it, and hand it back so the caller can continue. If the
   * window has NOT reset yet, report how long remains (do not resume early).
   *
   * @returns {{ ready:boolean, resumeAt?, msRemaining?, checkpoint? }}
   */
  resume() {
    if (!this.hasPendingResume()) return { ready: false, reason: 'no pending resume' };
    const payload = JSON.parse(fs.readFileSync(this.resumePath, 'utf8'));
    const resumeAt = new Date(payload.resumeAt).getTime();
    const now = this.clock();
    if (now < resumeAt) {
      return { ready: false, resumeAt: payload.resumeAt, msRemaining: resumeAt - now };
    }
    this.startNewWindow(now);
    fs.rmSync(this.resumePath, { force: true });
    log.debug('governor: resumed into a fresh window');
    return { ready: true, resumeAt: payload.resumeAt, checkpoint: payload.checkpoint };
  }
}

function round(n, dp) {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

module.exports = { UsageGovernor };
