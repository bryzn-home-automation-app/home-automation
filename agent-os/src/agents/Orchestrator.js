'use strict';

const { Agent } = require('./Agent');
const { DEFAULT_SPECIALISTS } = require('./registry');
const log = require('../util/logger');

/**
 * The Orchestrator is the Chief of Staff / Tech Lead. It:
 *   1. decomposes a request into subtasks (pluggable planner),
 *   2. routes each subtask to the best-fit specialist,
 *   3. runs them (respecting guardrails / human approval),
 *   4. consolidates results back into memory.
 *
 * It holds no domain knowledge itself — it coordinates. Every specialist shares
 * the same Context Compiler and Measurement Engine, so savings are measured
 * uniformly across the whole system.
 */
class Orchestrator {
  constructor(deps, options = {}) {
    this.compiler = deps.compiler;
    this.memory = deps.memory;
    this.skills = deps.skills;
    this.measurement = deps.measurement;
    this.consolidator = deps.consolidator;
    this.modelClient = deps.modelClient || null;

    // Guardrails: a predicate deciding whether a task needs human approval, and
    // an async approver the host wires up (defaults to auto-deny — safe by default).
    this.needsApproval = options.needsApproval || (() => false);
    this.approver = options.approver || (async () => false);

    this.agents = new Map();
    const roster = options.specialists || DEFAULT_SPECIALISTS;
    for (const def of roster) this.addAgent(def);
  }

  addAgent(def) {
    const agent = new Agent(def, {
      compiler: this.compiler,
      modelClient: this.modelClient,
      measurement: this.measurement,
    });
    this.agents.set(agent.name, agent);
    return agent;
  }

  /** Choose the specialist whose keywords best fit the goal (ties -> first). */
  route(goal) {
    let best = null;
    let bestFit = -1;
    for (const agent of this.agents.values()) {
      const f = agent.fit(goal);
      if (f > bestFit) {
        best = agent;
        bestFit = f;
      }
    }
    return best;
  }

  /**
   * Default planner: split on explicit list markers / "and then" boundaries.
   * A host can pass its own planner (e.g. an LLM planner) via options.planner.
   */
  plan(request, planner) {
    if (typeof planner === 'function') return planner(request);
    const text = String(request || '').trim();
    const parts = text
      .split(/\n+|(?:\s+and then\s+)|(?:;\s*)|(?:^\d+\.\s*)/gim)
      .map((s) => s.replace(/^\d+\.\s*/, '').trim())
      .filter((s) => s.length > 0);
    return parts.length ? parts : [text];
  }

  /**
   * Run a full request: plan -> route -> (approval) -> execute -> consolidate.
   * @returns {{ request, subtasks:Array, results:Array, summary:object }}
   */
  async run(request, options = {}) {
    const goals = this.plan(request, options.planner);
    const subtasks = goals.map((goal) => ({ goal, tags: options.tags || [], budget: options.budget }));
    const results = [];

    for (const task of subtasks) {
      const agent = this.route(task.goal);
      if (!agent) {
        results.push({ goal: task.goal, skipped: 'no matching agent' });
        continue;
      }

      // Guardrail: sensitive/irreversible work pauses for human approval.
      if (this.needsApproval(task, agent)) {
        const approved = await this.approver({ task, agent: agent.name });
        if (!approved) {
          results.push({ goal: task.goal, agent: agent.name, skipped: 'approval denied' });
          continue;
        }
      }

      const result = await agent.handle(task);
      results.push(result);

      // Consolidate what happened back into episodic memory for next time.
      if (this.consolidator && options.consolidate !== false) {
        this.consolidator.consolidate({ task, result });
      }
    }

    const summary = this.measurement ? this.measurement.summarize(results) : null;
    log.debug(`orchestrator ran ${subtasks.length} subtasks`);
    return { request, subtasks, results, summary };
  }
}

module.exports = { Orchestrator };
