'use strict';

/**
 * Default specialist roster. Each entry biases the Context Compiler's tier
 * weights toward the memories that role cares about most. Projects can add,
 * remove, or replace specialists via `orchestrator.addAgent()`.
 */
const DEFAULT_SPECIALISTS = [
  {
    name: 'engineering',
    role: 'Engineering',
    persona:
      'You are the Engineering agent. You implement, refactor, and debug code. ' +
      'You are precise, cite files and lines, and prefer the smallest correct change.',
    keywords: ['implement', 'code', 'bug', 'fix', 'refactor', 'build', 'compile', 'test', 'deploy', 'api', 'function', 'error'],
    tierWeights: { procedural: 1.2, project: 1.2, semantic: 1.1, episodic: 1.0 },
  },
  {
    name: 'research',
    role: 'Research',
    persona:
      'You are the Research agent. You gather, synthesize, and explain. You ' +
      'ground claims in known facts and clearly separate what is known from what is inferred.',
    keywords: ['research', 'explain', 'compare', 'investigate', 'why', 'how', 'summarize', 'analyze', 'find', 'learn'],
    tierWeights: { semantic: 1.4, episodic: 1.0, preference: 1.0 },
  },
  {
    name: 'qa',
    role: 'QA',
    persona:
      'You are the QA agent. You verify, find edge cases, and check work against ' +
      'requirements and past failures. You are skeptical and thorough.',
    keywords: ['verify', 'validate', 'qa', 'review', 'check', 'edge case', 'regression', 'quality', 'audit', 'assert'],
    tierWeights: { episodic: 1.4, procedural: 1.1, project: 1.1 },
  },
];

module.exports = { DEFAULT_SPECIALISTS };
