'use strict';

const log = require('../util/logger');

/**
 * A specialist Agent. Each agent has a role, a system persona, and optional
 * tier-weight preferences that bias which memories the Context Compiler favors
 * for its tasks (e.g. a QA agent leans on episodic failure history; a Research
 * agent leans on semantic facts).
 *
 * The actual model call is injected as `modelClient` so the Agent OS never hard-
 * depends on a specific SDK. A modelClient is:
 *     async ({ messages, task, agent }) => ({ text, usage:{inputTokens,outputTokens} })
 */
class Agent {
  constructor(def, deps) {
    this.name = def.name;
    this.role = def.role;
    this.persona = def.persona || `You are the ${def.role} agent.`;
    this.tierWeights = def.tierWeights || {};
    this.keywords = (def.keywords || []).map((k) => k.toLowerCase());
    this.compiler = deps.compiler;
    this.modelClient = deps.modelClient;
    this.measurement = deps.measurement;
  }

  /** How well this agent fits a task goal, in [0, ∞). Higher wins. */
  fit(goal) {
    const text = String(goal || '').toLowerCase();
    return this.keywords.reduce((n, k) => (text.includes(k) ? n + 1 : n), 0);
  }

  /**
   * Handle a task end-to-end: compile task-specific context, call the model,
   * and record a measurement comparing the compiled context against the naive
   * baseline (dumping all of memory).
   */
  async handle(task) {
    const started = Date.now();
    const compiled = this.compiler.compile({
      goal: task.goal,
      tags: task.tags,
      tierWeights: this.tierWeights,
      budget: task.budget,
    });

    // Prepend this agent's persona to the compiled system message.
    const messages = compiled.messages.map((m, i) =>
      i === 0 ? { ...m, content: `${this.persona}\n\n${m.content}` } : m
    );

    let response;
    if (this.modelClient) {
      response = await this.modelClient({ messages, task, agent: this.name });
    } else {
      response = { text: '[no modelClient configured — dry run]', usage: null };
    }

    const record = this.measurement
      ? this.measurement.record({
          task: task.goal,
          agent: this.name,
          report: compiled.report,
          usage: response.usage,
          latencyMs: Date.now() - started,
          quality: task.quality != null ? task.quality : null,
        })
      : null;

    log.debug(`agent ${this.name} handled task in ${Date.now() - started}ms`);
    return {
      agent: this.name,
      role: this.role,
      goal: task.goal,
      output: response.text,
      usage: response.usage,
      contextReport: compiled.report,
      messages,
      measurement: record,
    };
  }
}

module.exports = { Agent };
