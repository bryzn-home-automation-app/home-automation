'use strict';

const { shortId } = require('../util/id');

/**
 * A Skill is a reusable, named workflow: an ordered list of steps plus the
 * trigger keywords that suggest when it applies. Skills are declarative and
 * portable (plain JSON); actually performing a step is delegated to a
 * host-provided `stepRunner`, so the same skill definition works whether the
 * executor is a shell, an HTTP client, or another agent.
 */
class Skill {
  constructor(def) {
    this.id = def.id || shortId('skill');
    this.name = def.name;
    this.description = def.description || '';
    this.triggers = (def.triggers || []).map((t) => String(t).toLowerCase());
    this.steps = def.steps || []; // [{ action, note, args? }]
    this.source = def.source || 'authored';
    this.createdAt = def.createdAt || new Date().toISOString();
    this.runCount = def.runCount || 0;
    this.lastRunAt = def.lastRunAt || null;
  }

  /** Lexical relevance of this skill to a free-text goal, in [0,1]. */
  matchScore(goal) {
    const text = String(goal || '').toLowerCase();
    if (!this.triggers.length) return 0;
    const hits = this.triggers.filter((t) => text.includes(t)).length;
    return hits / this.triggers.length;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      triggers: this.triggers,
      steps: this.steps,
      source: this.source,
      createdAt: this.createdAt,
      runCount: this.runCount,
      lastRunAt: this.lastRunAt,
    };
  }
}

module.exports = { Skill };
