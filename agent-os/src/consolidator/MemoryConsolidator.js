'use strict';

const log = require('../util/logger');

/**
 * The Memory Consolidator closes the loop: after a task runs, it writes what
 * happened back into physical memory so future context compilations are better
 * informed. This is what makes the system *learn* rather than merely retrieve.
 *
 * By default it:
 *   - records an episodic event for the task + outcome,
 *   - boosts salience of the memories that were actually used (usage = value),
 *   - runs an optional `factExtractor` to promote durable facts to semantic memory.
 */
class MemoryConsolidator {
  constructor(config, memory, options = {}) {
    this.config = config;
    this.memory = memory;
    this.factExtractor = options.factExtractor || null; // (task, result) => [{content, tier, key?}]
    this.salienceBoost = options.salienceBoost != null ? options.salienceBoost : 0.05;
  }

  consolidate({ task, result }) {
    const usedIds = (result && result.contextReport && result.contextReport.keptIds) || [];

    // 1. Reinforce memories that proved useful.
    if (usedIds.length) {
      this.memory.touch(usedIds);
      for (const id of usedIds) {
        const rec = this.memory.all().find((r) => r.id === id);
        if (rec) this.memory.update(id, { salience: rec.salience + this.salienceBoost });
      }
    }

    // 2. Record the episode.
    const outcome = summarizeOutcome(result);
    const episode = this.memory.remember({
      tier: 'episodic',
      content: `Task: ${task.goal}\nAgent: ${result && result.agent ? result.agent : 'n/a'}\nOutcome: ${outcome}`,
      tags: ['episode', ...(task.tags || [])],
      source: 'consolidator',
      salience: 0.4,
      meta: {
        agent: result && result.agent,
        tokensUsed: result && result.contextReport && result.contextReport.tokensUsed,
      },
    });

    // 3. Promote durable facts, if an extractor is configured.
    const facts = [];
    if (this.factExtractor) {
      let extracted = [];
      try {
        extracted = this.factExtractor(task, result) || [];
      } catch (err) {
        log.warn(`factExtractor threw: ${err.message}`);
      }
      for (const f of extracted) {
        if (f && f.content) facts.push(this.memory.remember({ tier: f.tier || 'semantic', ...f, source: 'consolidator' }));
      }
    }

    log.debug(`consolidated task "${task.goal}" -> episode ${episode.id}, ${facts.length} facts, ${usedIds.length} reinforced`);
    return { episode, facts, reinforced: usedIds.length };
  }
}

function summarizeOutcome(result) {
  if (!result) return 'unknown';
  if (result.skipped) return `skipped (${result.skipped})`;
  const text = String(result.output || '').replace(/\s+/g, ' ').trim();
  return text.length > 200 ? text.slice(0, 200) + ' …' : text || 'completed';
}

module.exports = { MemoryConsolidator };
