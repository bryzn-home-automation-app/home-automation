'use strict';

const { resolveConfig } = require('./config');
const { MemoryEngine } = require('./memory/MemoryEngine');
const { ContextCompiler } = require('./context/ContextCompiler');
const { SkillsEngine } = require('./skills/SkillsEngine');
const { MeasurementEngine } = require('./measurement/MeasurementEngine');
const { MemoryConsolidator } = require('./consolidator/MemoryConsolidator');
const { Orchestrator } = require('./agents/Orchestrator');
const { RoutineEngine } = require('./routines/RoutineEngine');
const { ReviewEngine } = require('./review/ReviewEngine');
const { reversibilityGuard, classifyReversibility } = require('./agents/guardrails');
const { GENERAL_PURPOSE, DEFAULT_SPECIALISTS, STARTER_ROSTER } = require('./agents/registry');
const { UsageGovernor } = require('./governor/UsageGovernor');
const { runGoverned, resumeGoverned } = require('./governor/runGoverned');

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

  // Approval line by reversibility (opt-in). When the host asks for it, default
  // the guard so anything external/financial/permanent waits for a human.
  const orchestratorOptions = { ...(options.orchestrator || {}) };
  if (options.approvalByReversibility && !orchestratorOptions.needsApproval) {
    orchestratorOptions.needsApproval = reversibilityGuard(options.reversibility || {});
  }

  const orchestrator = new Orchestrator(
    { compiler, memory, skills, measurement, consolidator, modelClient: options.modelClient },
    orchestratorOptions
  );

  const routines = new RoutineEngine(config, { orchestrator, skills });
  const review = new ReviewEngine(config, { memory, measurement, routines, orchestrator });
  const governor = new UsageGovernor(config, options.governor || {});

  const os = {
    config,
    memory,
    compiler,
    skills,
    measurement,
    consolidator,
    orchestrator,
    routines,
    review,
    governor,
    /** Convenience: run a request through the orchestrator. */
    run: (request, runOptions) => orchestrator.run(request, runOptions),
  };

  /** Run a request under the Usage Governor (stops + schedules resume near the cap). */
  os.runGoverned = (request, runOptions) => runGoverned({ orchestrator, governor }, request, runOptions);
  /** Resume checkpointed work when the window has reset. */
  os.resumeGoverned = (runOptions) => resumeGoverned({ orchestrator, governor }, runOptions);

  return os;
}

module.exports = {
  createAgentOS,
  MemoryEngine,
  ContextCompiler,
  SkillsEngine,
  MeasurementEngine,
  MemoryConsolidator,
  Orchestrator,
  RoutineEngine,
  ReviewEngine,
  reversibilityGuard,
  classifyReversibility,
  UsageGovernor,
  runGoverned,
  resumeGoverned,
  GENERAL_PURPOSE,
  DEFAULT_SPECIALISTS,
  STARTER_ROSTER,
  resolveConfig,
};
