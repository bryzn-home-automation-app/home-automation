'use strict';

const fs = require('fs');
const path = require('path');
const { Skill } = require('./Skill');
const log = require('../util/logger');

/**
 * The Skills Engine loads, stores, matches, learns, and runs skills.
 *
 * Skills live as JSON files under <root>/skills, so they are portable and
 * versionable alongside a repo. `learnFromDemonstration` captures a sequence of
 * observed steps and promotes it to a first-class, reusable skill — the "teach
 * the agent a task, and the demonstrated workflow becomes a reusable skill"
 * idea from the reference architecture.
 */
class SkillsEngine {
  constructor(config) {
    this.config = config;
    this.dir = config.paths.skills;
    fs.mkdirSync(this.dir, { recursive: true });
    this.skills = new Map();
    this._load();
  }

  _load() {
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const def = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8'));
        const skill = new Skill(def);
        this.skills.set(skill.id, skill);
      } catch (err) {
        log.warn(`skipping malformed skill ${file}: ${err.message}`);
      }
    }
  }

  _persist(skill) {
    const file = path.join(this.dir, `${slug(skill.name)}.${skill.id}.json`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(skill.toJSON(), null, 2));
    fs.renameSync(tmp, file);
  }

  register(def) {
    const skill = def instanceof Skill ? def : new Skill(def);
    this.skills.set(skill.id, skill);
    this._persist(skill);
    log.debug(`registered skill "${skill.name}" (${skill.id})`);
    return skill;
  }

  /**
   * Promote a demonstrated sequence of steps into a reusable skill.
   * @param {{name, description?, steps:Array, triggers?:string[]}} demo
   */
  learnFromDemonstration(demo) {
    if (!demo || !demo.name || !Array.isArray(demo.steps) || demo.steps.length === 0) {
      throw new Error('learnFromDemonstration requires { name, steps: [...] }');
    }
    const triggers = demo.triggers && demo.triggers.length
      ? demo.triggers
      : inferTriggers(demo.name, demo.description, demo.steps);
    return this.register(new Skill({
      name: demo.name,
      description: demo.description || `Learned from demonstration on ${new Date().toISOString()}`,
      triggers,
      steps: demo.steps,
      source: 'demonstration',
    }));
  }

  list() {
    return [...this.skills.values()];
  }

  get(id) {
    return this.skills.get(id) || null;
  }

  /** Best skill for a goal, or null when nothing clears the threshold. */
  match(goal, threshold = 0.34) {
    let best = null;
    let bestScore = 0;
    for (const skill of this.skills.values()) {
      const s = skill.matchScore(goal);
      if (s > bestScore) {
        best = skill;
        bestScore = s;
      }
    }
    return bestScore >= threshold ? { skill: best, score: bestScore } : null;
  }

  /**
   * Execute a skill's steps via a host-provided runner.
   * @param {string} skillId
   * @param {(step, ctx)=>Promise<any>} stepRunner
   * @param {object} ctx - arbitrary context passed to each step
   */
  async run(skillId, stepRunner, ctx = {}) {
    const skill = this.get(skillId);
    if (!skill) throw new Error(`Unknown skill ${skillId}`);
    if (typeof stepRunner !== 'function') throw new Error('run() needs a stepRunner function');
    const results = [];
    for (let i = 0; i < skill.steps.length; i++) {
      const step = skill.steps[i];
      const result = await stepRunner(step, { ...ctx, index: i, skill });
      results.push({ step, result });
    }
    skill.runCount += 1;
    skill.lastRunAt = new Date().toISOString();
    this._persist(skill);
    return { skill: skill.name, steps: results };
  }
}

function inferTriggers(name, description, steps) {
  const text = [name, description, ...steps.map((s) => s.action || '')].join(' ').toLowerCase();
  const words = text.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
  return [...new Set(words)].slice(0, 8);
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'skill';
}

module.exports = { SkillsEngine };
