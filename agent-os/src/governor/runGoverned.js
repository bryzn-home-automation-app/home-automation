'use strict';

/**
 * Run a request under the Usage Governor. Subtasks execute one at a time; after
 * each, measured usage is recorded and the window phase is re-checked. When the
 * window reaches the prepare threshold, the loop finishes the current (safe)
 * step, checkpoints the remaining subtasks, stops gracefully, and schedules a
 * resume for when the window resets — exactly the diagram's flow.
 *
 * On resume (a fresh session), `resumeGoverned` restores the checkpoint and
 * continues the remaining subtasks automatically.
 */

function usageOf(result) {
  // Sum token usage across a run's subtask results.
  let input = 0;
  let output = 0;
  for (const r of result.results || []) {
    if (r && r.usage) {
      input += r.usage.inputTokens || 0;
      output += r.usage.outputTokens || 0;
    }
  }
  return { inputTokens: input, outputTokens: output };
}

async function runGoverned(deps, request, opts = {}) {
  const { orchestrator, governor } = deps;
  const goals = opts.goals || orchestrator.plan(request, opts.planner);
  const completed = opts.completed ? [...opts.completed] : [];
  const remaining = [...goals];
  const runResults = [];

  while (remaining.length) {
    // Finish-safe-step semantics: never START a new step once we're in prepare.
    // (The step we just finished is the safe stopping point.)
    if (governor.shouldPrepare() && completed.length > 0) break;

    const goal = remaining.shift();
    const res = await orchestrator.run(goal, {
      tags: opts.tags,
      budget: opts.budget,
      consolidate: opts.consolidate,
    });
    runResults.push(res);
    completed.push(goal);
    governor.record(usageOf(res)); // advances the window; may flip phase to prepare
  }

  const status = governor.status();

  if (remaining.length > 0) {
    // Stopped early for the window. Save what's left and schedule the resume.
    const resumePlan = await governor.prepareStop({
      request,
      remaining,
      completed,
      tags: opts.tags,
      budget: opts.budget,
    });
    return { status: 'stopped', phase: status.phase, completed, remaining, results: runResults, resumePlan, governor: status };
  }

  return { status: 'completed', phase: status.phase, completed, remaining: [], results: runResults, governor: status };
}

/**
 * Resume previously-checkpointed work. If the window has reset, restores the
 * checkpoint and continues; otherwise reports how long remains (does not resume
 * early).
 */
async function resumeGoverned(deps, opts = {}) {
  const { governor } = deps;
  const r = governor.resume();
  if (!r.ready) return { resumed: false, ...r };
  const cp = r.checkpoint || {};
  const result = await runGoverned(deps, cp.request, {
    goals: cp.remaining || [],
    completed: cp.completed || [],
    tags: cp.tags,
    budget: cp.budget,
    ...opts,
  });
  return { resumed: true, ...result };
}

module.exports = { runGoverned, resumeGoverned, usageOf };
