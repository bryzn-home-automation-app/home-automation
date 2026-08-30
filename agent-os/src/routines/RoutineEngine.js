'use strict';

const fs = require('fs');
const path = require('path');
const { shortId } = require('../util/id');
const log = require('../util/logger');

/**
 * Routines — the playbook's "teach one recurring, multi-tool task by
 * demonstration and turn it into one routine with a schedule or trigger."
 *
 * A routine binds a unit of work (either a learned Skill or an Orchestrator
 * request) to a firing condition:
 *   - schedule: { intervalMs }   — fire at most once per interval, and
 *   - trigger:  "<event-name>"   — fire when that event is dispatched.
 *
 * This library has no daemon of its own (it stays portable and side-effect
 * free), so firing is driven by the host: call `due(now, { event })` to see what
 * should run, or `runDue(...)` to run them. Every run is appended to a JSONL log
 * so the weekly review can report what each routine ran, produced, and skipped.
 */
class RoutineEngine {
  constructor(config, deps = {}) {
    this.config = config;
    this.dir = path.join(config.paths.root, 'routines');
    this.logFile = path.join(config.paths.root, 'routines.jsonl');
    fs.mkdirSync(this.dir, { recursive: true });
    this.orchestrator = deps.orchestrator || null;
    this.skills = deps.skills || null;
    this.routines = new Map();
    this._load();
  }

  _load() {
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const def = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8'));
        this.routines.set(def.id, def);
      } catch (err) {
        log.warn(`skipping malformed routine ${file}: ${err.message}`);
      }
    }
  }

  _persist(routine) {
    const file = path.join(this.dir, `${routine.id}.json`);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(routine, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  }

  /**
   * @param {object} def { name, request? | skillId?, schedule?:{intervalMs}, trigger?, tags?, enabled? }
   */
  register(def) {
    if (!def || !def.name) throw new Error('routine requires a name');
    if (!def.request && !def.skillId) throw new Error('routine requires a request or a skillId');
    const routine = {
      id: def.id || shortId('routine'),
      name: def.name,
      request: def.request || null,
      skillId: def.skillId || null,
      schedule: def.schedule || null, // { intervalMs }
      trigger: def.trigger || null, // event name
      tags: def.tags || [],
      enabled: def.enabled !== false,
      createdAt: def.createdAt || new Date().toISOString(),
      lastRunAt: def.lastRunAt || null,
      runCount: def.runCount || 0,
    };
    this.routines.set(routine.id, routine);
    this._persist(routine);
    return routine;
  }

  /** Promote a learned skill directly into a scheduled/triggered routine. */
  fromSkill(skillId, { name, schedule, trigger, tags } = {}) {
    const skill = this.skills && this.skills.get(skillId);
    if (!skill) throw new Error(`Unknown skill ${skillId}`);
    return this.register({ name: name || `Routine: ${skill.name}`, skillId, schedule, trigger, tags });
  }

  list() {
    return [...this.routines.values()];
  }

  get(id) {
    return this.routines.get(id) || null;
  }

  /**
   * Which routines should fire right now.
   * @param {number} [now=Date.now()]
   * @param {object} [opts] { event }  — a trigger event being dispatched
   */
  due(now = Date.now(), opts = {}) {
    return this.list().filter((r) => {
      if (!r.enabled) return false;
      if (opts.event && r.trigger === opts.event) return true;
      if (r.schedule && r.schedule.intervalMs) {
        const last = r.lastRunAt ? new Date(r.lastRunAt).getTime() : 0;
        return now - last >= r.schedule.intervalMs;
      }
      return false;
    });
  }

  /**
   * Run one routine now. Uses the wired Orchestrator (for `request` routines) or
   * Skills engine (for `skillId` routines). `stepRunner` is required for skills.
   */
  async run(routineId, { stepRunner, runOptions } = {}) {
    const routine = this.get(routineId);
    if (!routine) throw new Error(`Unknown routine ${routineId}`);
    const started = Date.now();
    let status = 'ok';
    let produced = null;
    let skipped = [];
    try {
      if (routine.request) {
        if (!this.orchestrator) throw new Error('no orchestrator wired for request routines');
        const res = await this.orchestrator.run(routine.request, runOptions || {});
        produced = res.summary;
        skipped = res.results.filter((r) => r.skipped).map((r) => ({ goal: r.goal, why: r.skipped }));
      } else if (routine.skillId) {
        if (!this.skills) throw new Error('no skills engine wired for skill routines');
        if (!stepRunner) throw new Error('skill routines require a stepRunner');
        produced = await this.skills.run(routine.skillId, stepRunner, { routine: routine.name });
      }
    } catch (err) {
      status = 'error';
      produced = { error: err.message };
    }

    routine.lastRunAt = new Date().toISOString();
    routine.runCount += 1;
    this._persist(routine);

    const entry = {
      ts: routine.lastRunAt,
      routineId: routine.id,
      routine: routine.name,
      status,
      durationMs: Date.now() - started,
      produced,
      skipped,
    };
    fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
    log.debug(`ran routine "${routine.name}" -> ${status}`);
    return entry;
  }

  /** Run everything due; returns the run-log entries. */
  async runDue(now = Date.now(), opts = {}) {
    const entries = [];
    for (const r of this.due(now, opts)) {
      entries.push(await this.run(r.id, opts));
    }
    return entries;
  }

  /** Enable/disable without deleting (weekly-review pruning is reversible). */
  setEnabled(id, enabled) {
    const r = this.get(id);
    if (!r) return null;
    r.enabled = enabled;
    this._persist(r);
    return r;
  }

  /** Permanently remove a routine you would not miss. */
  prune(id) {
    const r = this.get(id);
    if (!r) return false;
    this.routines.delete(id);
    try {
      fs.rmSync(path.join(this.dir, `${id}.json`), { force: true });
    } catch (_) {
      /* best effort */
    }
    return true;
  }

  /** Read the run log (optionally since a timestamp). */
  runs({ since } = {}) {
    let entries;
    try {
      entries = fs.readFileSync(this.logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    if (since) {
      const cutoff = new Date(since).getTime();
      entries = entries.filter((e) => new Date(e.ts).getTime() >= cutoff);
    }
    return entries;
  }
}

module.exports = { RoutineEngine };
