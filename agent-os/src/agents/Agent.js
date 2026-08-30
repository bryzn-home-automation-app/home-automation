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
    // A charter is the agent's written mandate (per the build playbook): what it
    // owns, what "good" looks like, and what it never does without asking. The
    // last drives the approval guard; all three surface in the weekly review.
    this.charter = {
      owns: (def.charter && def.charter.owns) || def.owns || [],
      goodLooksLike: (def.charter && def.charter.goodLooksLike) || def.goodLooksLike || [],
      neverWithoutAsking: (def.charter && def.charter.neverWithoutAsking) || def.neverWithoutAsking || [],
    };
    this.compiler = deps.compiler;
    this.modelClient = deps.modelClient;
    this.measurement = deps.measurement;
  }

  /** Render persona + charter as the agent's system framing. */
  _personaWithCharter() {
    const c = this.charter;
    const lines = [];
    if (c.owns.length) lines.push(`You own: ${c.owns.join('; ')}.`);
    if (c.goodLooksLike.length) lines.push(`Good looks like: ${c.goodLooksLike.join('; ')}.`);
    if (c.neverWithoutAsking.length) lines.push(`Never do without asking: ${c.neverWithoutAsking.join('; ')}.`);
    return lines.length ? `${this.persona}\n\nCharter — ${lines.join(' ')}` : this.persona;
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

    // Prepend this agent's persona (and charter, if any) to the system message.
    const persona = this._personaWithCharter();
    const messages = compiled.messages.map((m, i) =>
      i === 0 ? { ...m, content: `${persona}\n\n${m.content}` } : m
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
