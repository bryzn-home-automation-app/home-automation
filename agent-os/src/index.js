'use strict';

const { resolveConfig } = require('./config');
const { MemoryEngine } = require('./memory/MemoryEngine');
const { ContextCompiler } = require('./context/ContextCompiler');
const { SkillsEngine } = require('./skills/SkillsEngine');
const { MeasurementEngine } = require('./measurement/MeasurementEngine');
const { MemoryConsolidator } = require('./consolidator/MemoryConsolidator');
const { Orchestrator } = require('./agents/Orchestrator');

/**
 * Assemble a fully wired Agent OS instance around a physical-memory root.
 *
 * @param {object} [options]
 * @param {string} [options.root]         Physical memory dir (default <cwd>/.agent-os)
 * @param {function} [options.modelClient] async ({messages,task,agent}) => {text, usage}
 * @param {object}  [options.consolidator] { factExtractor, salienceBoost }
 * @param {object}  [options.orchestrator] { specialists, needsApproval, approver, planner }
 * @returns {{ config, memory, compiler, skills, measurement, consolidator, orchestrator, run }}
 */
function createAgentOS(options = {}) {
  const config = resolveConfig(options);

  const memory = new MemoryEngine(config);
  const compiler = new ContextCompiler(config, memory);
  const skills = new SkillsEngine(config);
  const measurement = new MeasurementEngine(config);
  const consolidator = new MemoryConsolidator(config, memory, options.consolidator || {});

  const orchestrator = new Orchestrator(
    { compiler, memory, skills, measurement, consolidator, modelClient: options.modelClient },
    options.orchestrator || {}
  );

  return {
    config,
    memory,
    compiler,
    skills,
    measurement,
    consolidator,
    orchestrator,
    /** Convenience: run a request through the orchestrator. */
    run: (request, runOptions) => orchestrator.run(request, runOptions),
  };
}

module.exports = {
  createAgentOS,
  MemoryEngine,
  ContextCompiler,
  SkillsEngine,
  MeasurementEngine,
  MemoryConsolidator,
  Orchestrator,
  resolveConfig,
};
