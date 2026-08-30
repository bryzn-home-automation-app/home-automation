'use strict';

/**
 * Weekly review — the playbook's cadence:
 *
 *   "Review weekly. Ask each bot what it ran, what it produced, and what it
 *    skipped, then prune routines you would not miss."
 *
 * The ReviewEngine reconstructs that report from what the system already
 * records: the Measurement log (what ran + token/cost impact), episodic memory
 * (produced + skipped, via consolidated episodes), and the Routine run log. It
 * also flags routines that did not fire in the window as prune candidates.
 *
 * It only reports and recommends — pruning stays a human action
 * (`routines.prune(id)`), matching the article's "prune routines you would not
 * miss."
 */
class ReviewEngine {
  constructor(config, deps = {}) {
    this.config = config;
    this.memory = deps.memory;
    this.measurement = deps.measurement;
    this.routines = deps.routines || null;
    this.orchestrator = deps.orchestrator || null;
  }

  /**
   * @param {object} [opts] { since }  default: 7 days ago
   * @returns {{ window, agents, routines, totals }}
   */
  weekly(opts = {}) {
    const since = opts.since ? new Date(opts.since) : new Date(Date.now() - 7 * 86400000);
    const sinceMs = since.getTime();

    const measurements = this.measurement
      ? this.measurement.history().filter((m) => new Date(m.ts).getTime() >= sinceMs)
      : [];
    const episodes = this.memory
      ? this.memory.all('episodic').filter((e) => new Date(e.createdAt).getTime() >= sinceMs)
      : [];

    // --- Per-agent report ---
    const agentNames = this.orchestrator ? [...this.orchestrator.agents.keys()] : [];
    // Include any agent that shows up in measurements even if not currently registered.
    for (const m of measurements) if (m.agent && !agentNames.includes(m.agent)) agentNames.push(m.agent);

    const agents = agentNames.map((name) => {
      const mine = measurements.filter((m) => m.agent === name);
      const myEpisodes = episodes.filter((e) => e.meta && e.meta.agent === name);
      const skipped = myEpisodes.filter((e) => /Outcome: skipped/.test(e.content));
      const ran = mine.length;
      const agent = this.orchestrator ? this.orchestrator.agents.get(name) : null;
      return {
        agent: name,
        charter: agent ? agent.charter : undefined,
        ran,
        produced: mine.map((m) => truncate(m.task)),
        skipped: skipped.map((e) => firstLine(e.content)),
        tokensAvoided: sum(mine, 'tokensAvoided'),
        costAvoidedUsd: round(sum(mine, 'costAvoidedUsd'), 6),
        avgReductionPct: ran ? round(sum(mine, 'reductionPct') / ran, 4) : 0,
      };
    });

    // --- Per-routine report + prune candidates ---
    let routines = [];
    if (this.routines) {
      const runs = this.routines.runs({ since });
      routines = this.routines.list().map((r) => {
        const myRuns = runs.filter((x) => x.routineId === r.id);
        const errors = myRuns.filter((x) => x.status === 'error').length;
        return {
          id: r.id,
          name: r.name,
          enabled: r.enabled,
          runsInWindow: myRuns.length,
          errors,
          lastRunAt: r.lastRunAt,
          // A routine you would not miss: never fired in the window (or disabled).
          pruneCandidate: myRuns.length === 0,
          skipped: myRuns.flatMap((x) => x.skipped || []),
        };
      });
    }

    const totals = {
      tasksRun: measurements.length,
      tokensAvoided: sum(measurements, 'tokensAvoided'),
      costAvoidedUsd: round(sum(measurements, 'costAvoidedUsd'), 6),
      routinesFired: routines.reduce((n, r) => n + r.runsInWindow, 0),
      pruneCandidates: routines.filter((r) => r.pruneCandidate).map((r) => r.name),
    };

    return { window: { since: since.toISOString(), until: new Date().toISOString() }, agents, routines, totals };
  }

  /** Human-readable rendering of the weekly review. */
  render(report = this.weekly()) {
    const lines = [];
    lines.push(`# Weekly review  (${report.window.since.slice(0, 10)} → ${report.window.until.slice(0, 10)})`);
    lines.push('');
    lines.push(`Tasks run: ${report.totals.tasksRun} · tokens avoided: ${report.totals.tokensAvoided} · ` +
      `cost avoided: $${report.totals.costAvoidedUsd} · routines fired: ${report.totals.routinesFired}`);
    lines.push('');
    for (const a of report.agents) {
      lines.push(`## ${a.agent}  — ran ${a.ran}, skipped ${a.skipped.length}`);
      if (a.charter && a.charter.owns && a.charter.owns.length) lines.push(`  owns: ${a.charter.owns.join('; ')}`);
      if (a.produced.length) lines.push(`  produced: ${a.produced.slice(0, 5).join(' | ')}${a.produced.length > 5 ? ' …' : ''}`);
      if (a.skipped.length) lines.push(`  skipped: ${a.skipped.slice(0, 5).join(' | ')}`);
      lines.push(`  tokens avoided: ${a.tokensAvoided} · avg reduction: ${(a.avgReductionPct * 100).toFixed(1)}%`);
    }
    if (report.routines.length) {
      lines.push('');
      lines.push('## Routines');
      for (const r of report.routines) {
        const flag = r.pruneCandidate ? '  ⚠ prune candidate (did not fire)' : '';
        lines.push(`  - ${r.name}: ${r.runsInWindow} run(s), ${r.errors} error(s)${flag}`);
      }
      if (report.totals.pruneCandidates.length) {
        lines.push('');
        lines.push(`Prune candidates: ${report.totals.pruneCandidates.join(', ')}`);
      }
    }
    return lines.join('\n');
  }
}

function sum(arr, field) {
  return arr.reduce((a, x) => a + (x[field] || 0), 0);
}
function round(n, dp) {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
function truncate(s, n = 60) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}
function firstLine(s) {
  return truncate(String(s || '').split('\n')[0]);
}

module.exports = { ReviewEngine };
