#!/usr/bin/env node
'use strict';

/**
 * A resumable, usage-governed job — the exact script a scheduled wake-up runs.
 *
 *   node examples/governed-job.js --root <dir> [--request "<work>"] [--window-ms N] [--budget N]
 *
 * Behaviour:
 *   - If a resume checkpoint is waiting AND the window has reset → continue it.
 *   - Otherwise → start the request fresh under the governor.
 *   - When the governor hits the prepare threshold, it stops, checkpoints the
 *     remaining work, and books a resume via a file scheduler. An external waker
 *     (cron / a Claude Code trigger) re-runs THIS script when the window resets.
 *
 * It is safe to run repeatedly: it self-detects resume vs. fresh start. The
 * --window-ms flag exists only so the whole loop can be exercised in seconds
 * instead of waiting 5 real hours.
 */

const path = require('path');
const { createAgentOS, fileScheduler, readResumeRequest } = require('../src/index');

function flag(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

// Fixed per-task usage so the demo is deterministic; a real job returns real usage.
const fixedUsage = (t) => async () => ({ text: 'ok', usage: { inputTokens: t, outputTokens: 0 } });

async function main() {
  const root = path.resolve(flag('root', '.agent-os-job'));
  const request = flag('request', 'plan the work\nand then build part one\nand then build part two\nand then verify everything');
  const windowMs = Number(flag('window-ms', String(5 * 3600 * 1000)));
  const budget = Number(flag('budget', '400'));
  const resumeFile = path.join(root, 'resume-request.json');

  const ai = createAgentOS({
    root,
    modelClient: fixedUsage(200),
    governor: {
      budgetTokens: budget,
      prepareAt: 0.9,
      windowMs,
      scheduler: fileScheduler(resumeFile), // books the next-window pickup
    },
  });

  const pending = ai.governor.hasPendingResume();
  const label = pending ? 'RESUME' : 'START';
  console.log(`[${label}] root=${root}`);
  console.log(`  usage before: ${(ai.governor.usageFraction() * 100).toFixed(0)}%  phase=${ai.governor.status().phase}`);

  const out = pending ? await ai.resumeGoverned() : await ai.runGoverned(request);

  if (out.resumed === false && out.ready === false) {
    // A checkpoint exists but the window has not reset yet.
    console.log(`  not ready — window resets in ${Math.ceil((out.msRemaining || 0) / 1000)}s`);
    return;
  }

  console.log(`  status: ${out.status}`);
  console.log(`  completed this run: ${out.completed.length} step(s)${out.remaining.length ? `, deferred ${out.remaining.length}` : ''}`);
  if (out.status === 'stopped') {
    const req = readResumeRequest(resumeFile);
    console.log(`  → resume booked for ${out.resumePlan.resumeAt} (file: ${path.basename(resumeFile)})`);
    if (req) console.log(`  → waker should run: ${req.command} --root ${root}`);
  } else {
    console.log('  ✓ all work complete');
  }
}

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
