#!/usr/bin/env node
'use strict';

/**
 * End-to-end demo of the Agent OS with a mock model client (no network).
 *
 * Run: node examples/demo.js
 *
 * It seeds physical memory with a handful of facts, then runs a multi-part
 * request through the orchestrator and prints the token-efficiency report — the
 * whole point: a large memory, a small compiled context.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAgentOS } = require('../src/index');

// Isolated scratch root so the demo never pollutes a real project.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-os-demo-'));

// A mock "Claude": counts input tokens, returns a canned answer. Swap this for
// a real Anthropic SDK call (see README) to go live.
const modelClient = async ({ messages, agent }) => {
  const inputTokens = messages.reduce((n, m) => n + Math.ceil((m.content || '').length / 4), 0);
  return { text: `(${agent}) acknowledged; used ${inputTokens} input tokens of compiled context`, usage: { inputTokens, outputTokens: 20 } };
};

async function main() {
  const ai = createAgentOS({ root, model: 'claude-sonnet', modelClient });

  // --- Seed physical memory (this can be thousands of records in real use) ---
  ai.memory.remember({ tier: 'semantic', content: 'The backend is a Spring Boot service on port 8080 with JWT auth (RBAC: ADMIN/USER/GUEST).', tags: ['backend', 'auth'] });
  ai.memory.remember({ tier: 'semantic', content: 'Postgres runs on port 5432; usage tables are append-only with source + ingestion_batch_id.', tags: ['database'] });
  ai.memory.remember({ tier: 'semantic', content: 'The frontend is a React SPA built with Vite and served by nginx on port 80.', tags: ['frontend'] });
  ai.memory.remember({ tier: 'semantic', content: 'scripts/sync.js drives CoServ SmartHub via Playwright and writes straight to Postgres.', tags: ['sync'] });
  ai.memory.remember({ tier: 'project', content: 'Deploy via the deploy-nuc alias; Docker runs on the NUC, not the dev machine.', key: 'deploy.target', salience: 0.9, tags: ['deploy'] });
  ai.memory.remember({ tier: 'preference', content: 'Prefer the smallest correct change; cite file:line.', tags: ['style'] });
  ai.memory.remember({ tier: 'episodic', content: 'On 2026-08-14 the hourly sync landed only 5/24 rows mid-day — expected, not a failure.', tags: ['sync'] });

  // A learned skill (from demonstration).
  ai.skills.learnFromDemonstration({
    name: 'Trigger daily sync',
    description: 'Kick the daily CoServ sync and confirm a row landed.',
    steps: [
      { action: 'POST /api/admin/sync/daily' },
      { action: 'query electric_usage for yesterday' },
      { action: 'assert row count >= 1' },
    ],
    triggers: ['daily sync', 'coserv'],
  });

  console.log('Physical memory seeded:', JSON.stringify(ai.memory.stats()));
  console.log('Skills:', ai.skills.list().map((s) => s.name).join(', '), '\n');

  // --- Memory admission policy: not everything deserves durable storage ------
  console.log('=== Admission policy (memory.consider) ===');
  const candidates = [
    { tier: 'semantic', content: 'The nginx reverse proxy listens on port 80 in front of the SPA.' }, // material
    { tier: 'semantic', content: 'Thanks, sounds good!' },                                            // filler
    { tier: 'semantic', content: 'Let me go check the scheduler code next.' },                        // reasoning
    { tier: 'project', content: 'The token maybe expires, probably after an hour I think.' },         // speculation
    { tier: 'project', content: 'Currently working on the hourly sync; next step is aggregation.' },  // stale state
    { tier: 'semantic', content: 'Postgres runs on port 5432; usage tables are append-only with source + ingestion_batch_id.' }, // duplicate
  ];
  for (const c of candidates) {
    const v = ai.memory.consider(c);
    console.log(`  ${v.decision.padEnd(8)} [${(v.reasons || []).join(',')}]  "${c.content.slice(0, 52)}${c.content.length > 52 ? '…' : ''}"`);
  }
  console.log('  → durable memory after gating:', JSON.stringify(ai.memory.stats()), '\n');

  // --- Run a multi-part request ---
  const request =
    'research how the sync writes to the database\n' +
    'and then implement a guard for the deploy target\n' +
    'and then verify nothing regressed in auth';

  const result = await ai.run(request, { tags: ['sync', 'deploy', 'auth'] });

  for (const r of result.results) {
    console.log(`\n▶ [${r.role || 'unrouted'}] ${r.goal}`);
    console.log(`  output: ${r.output || r.skipped}`);
    if (r.contextReport) {
      console.log(`  context: kept ${r.contextReport.keptCount}/${r.contextReport.candidateCount} records, ` +
        `${r.contextReport.tokensUsed} tokens (baseline ${r.contextReport.baselineTokens})`);
    }
  }

  console.log('\n=== Measurement summary ===');
  console.log(JSON.stringify(result.summary, null, 2));

  // --- Approval line by reversibility + a routine + weekly review -----------
  console.log('\n=== Approval line by reversibility ===');
  const guarded = createAgentOS({
    root,
    modelClient,
    approvalByReversibility: true,
    orchestrator: { approver: async ({ task }) => { console.log(`  (would ask a human about: "${task.goal}")`); return false; } },
  });
  const g = await guarded.run('refactor the sync helper\nand then deploy the backend to production');
  for (const r of g.results) {
    console.log(`  ${r.skipped ? 'WAIT ' : 'DONE '} ${r.goal}${r.skipped ? `  → ${r.skipped}` : ''}`);
  }

  console.log('\n=== Routine (demonstrated task + schedule) ===');
  const routine = guarded.routines.register({
    name: 'Nightly module research',
    request: 'research how the code modules fit together',
    schedule: { intervalMs: 86400000 },
  });
  const entry = await guarded.routines.run(routine.id);
  console.log(`  ran "${routine.name}" → ${entry.status}, avoided ${entry.produced.tokensAvoided} tokens`);

  console.log('\n=== Weekly review ===');
  console.log(guarded.review.render());

  fs.rmSync(root, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
