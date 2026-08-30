#!/usr/bin/env node
'use strict';

/**
 * agent-os CLI — inspect and drive a physical-memory Agent OS from the shell.
 *
 * Usage:
 *   agent-os remember <tier> "<content>" [--tags a,b] [--key k] [--salience 0.7]
 *   agent-os compile "<goal>" [--budget 2000] [--tags a,b]
 *   agent-os run "<request>"
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
      'usage: agent-os <remember|compile|run|stats|measure|skills|decay> [args] [--root dir]'
    );
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
