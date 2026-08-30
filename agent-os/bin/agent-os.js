#!/usr/bin/env node
'use strict';

/**
 * agent-os CLI — inspect and drive a physical-memory Agent OS from the shell.
 *
 * Usage:
 *   agent-os remember <tier> "<content>" [--tags a,b] [--key k] [--salience 0.7]
 *   agent-os consider <tier> "<content>" [--key k] [--confidence 0.8]   # admission-gated
 *   agent-os compile "<goal>" [--budget 2000] [--tags a,b]
 *   agent-os run "<request>"
 *   agent-os routines [add "<name>" "<request>" [--every ms] [--trigger e] | run <id> | due | prune <id>]
 *   agent-os review [--since <iso>] [--json]
 *   agent-os governor [status | record <tokens> | resume | reset]
 *   agent-os stats
 *   agent-os measure                 # summarize measurement history
 *   agent-os skills                  # list skills
 *   agent-os decay
 *
 * Physical memory lives in ./.agent-os by default (override with --root <dir>).
 */

const { createAgentOS } = require('../src/index');

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function main() {
  const [, , command, ...rest] = process.argv;
  const { flags, positional } = parseFlags(rest);
  const os = createAgentOS({ root: flags.root });

  const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

  switch (command) {
    case 'remember': {
      const [tier, content] = positional;
      if (!tier || !content) return usage('remember <tier> "<content>"');
      const rec = os.memory.remember({
        tier,
        content,
        tags: list(flags.tags),
        key: flags.key || null,
        salience: flags.salience != null ? Number(flags.salience) : undefined,
        source: 'cli',
      });
      console.log(`remembered ${rec.id} in ${rec.tier}`);
      break;
    }
    case 'consider': {
      // Run a candidate through the admission policy WITHOUT the low-level
      // guarantee of `remember` — this is the gate: promote / episodic / discard.
      const [tier, content] = positional;
      if (!tier || !content) return usage('consider <tier> "<content>" [--key k] [--confidence 0.8]');
      const verdict = os.memory.consider({
        tier,
        content,
        tags: list(flags.tags),
        key: flags.key || null,
        confidence: flags.confidence != null ? Number(flags.confidence) : undefined,
        source: 'cli',
      });
      console.log(JSON.stringify({
        decision: verdict.decision,
        tier: verdict.tier,
        reasons: verdict.reasons,
        materiality: verdict.materiality,
        storedId: verdict.record ? verdict.record.id : null,
      }, null, 2));
      break;
    }
    case 'compile': {
      const [goal] = positional;
      if (!goal) return usage('compile "<goal>"');
      const { context, report } = os.compiler.compile({
        goal,
        tags: list(flags.tags),
        budget: flags.budget != null ? Number(flags.budget) : undefined,
      });
      console.log('--- compiled context ---');
      console.log(context || '(empty)');
      console.log('\n--- report ---');
      console.log(JSON.stringify(report, null, 2));
      break;
    }
    case 'run': {
      const [request] = positional;
      if (!request) return usage('run "<request>"');
      const result = await os.run(request, { tags: list(flags.tags) });
      console.log(JSON.stringify({ subtasks: result.subtasks.length, summary: result.summary }, null, 2));
      for (const r of result.results) {
        console.log(`\n[${r.agent || 'unrouted'}] ${r.goal}`);
        console.log(r.output || r.skipped || '');
      }
      break;
    }
    case 'routines': {
      const sub = positional[0];
      if (sub === 'add') {
        const [, name, request] = positional;
        if (!name || !request) return usage('routines add "<name>" "<request>" [--every <ms>] [--trigger <event>]');
        const r = os.routines.register({
          name,
          request,
          schedule: flags.every ? { intervalMs: Number(flags.every) } : null,
          trigger: flags.trigger || null,
        });
        console.log(`registered routine ${r.id} (${r.name})`);
      } else if (sub === 'run') {
        const entry = await os.routines.run(positional[1]);
        console.log(JSON.stringify(entry, null, 2));
      } else if (sub === 'due') {
        console.log(JSON.stringify(os.routines.due(Date.now(), { event: flags.event }).map((r) => r.name), null, 2));
      } else if (sub === 'prune') {
        console.log(os.routines.prune(positional[1]) ? 'pruned' : 'not found');
      } else {
        for (const r of os.routines.list()) {
          const when = r.schedule ? `every ${r.schedule.intervalMs}ms` : r.trigger ? `on ${r.trigger}` : 'manual';
          console.log(`${r.id}  ${r.name}  (${when}, runs: ${r.runCount}${r.enabled ? '' : ', disabled'})`);
        }
        if (!os.routines.list().length) console.log('(no routines) — add one: agent-os routines add "<name>" "<request>"');
      }
      break;
    }
    case 'review': {
      const report = os.review.weekly(flags.since ? { since: flags.since } : {});
      console.log(flags.json ? JSON.stringify(report, null, 2) : os.review.render(report));
      break;
    }
    case 'governor': {
      const sub = positional[0];
      if (sub === 'record') {
        console.log(JSON.stringify(os.governor.record(Number(positional[1]) || 0), null, 2));
      } else if (sub === 'reset') {
        console.log(JSON.stringify(os.governor.startNewWindow(), null, 2));
      } else if (sub === 'resume') {
        console.log(JSON.stringify(await os.resumeGoverned(), null, 2));
      } else {
        console.log(JSON.stringify(os.governor.status(), null, 2));
      }
      break;
    }
    case 'stats':
      console.log(JSON.stringify(os.memory.stats(), null, 2));
      break;
    case 'measure':
      console.log(JSON.stringify(os.measurement.summarize(
        os.measurement.history().map((m) => ({ measurement: m }))
      ), null, 2));
      break;
    case 'skills':
      for (const s of os.skills.list()) {
        console.log(`${s.id}  ${s.name}  (runs: ${s.runCount})  triggers: ${s.triggers.join(', ')}`);
      }
      if (!os.skills.list().length) console.log('(no skills registered)');
      break;
    case 'decay':
      console.log(JSON.stringify(os.memory.decay(), null, 2));
      break;
    default:
      usage();
  }
}

function usage(hint) {
  if (hint) console.error(`usage: agent-os ${hint}`);
  else {
    console.error(
      'usage: agent-os <remember|consider|compile|run|routines|review|governor|stats|measure|skills|decay> [args] [--root dir]'
    );
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
