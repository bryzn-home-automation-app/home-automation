'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createAgentOS } = require('../src/index');
const { tmpRoot, cleanup } = require('./helpers');

function seed(a) {
  a.memory.remember({ tier: 'semantic', content: 'The backend is a Spring Boot service on port 8080.', tags: ['backend'] });
  a.memory.remember({ tier: 'semantic', content: 'Postgres runs on port 5432 and stores usage rows.', tags: ['database'] });
  a.memory.remember({ tier: 'semantic', content: 'The frontend is a React SPA served by nginx.', tags: ['frontend'] });
  a.memory.remember({ tier: 'preference', content: 'Prefer the smallest correct change.', tags: ['style'] });
}

test('compiler selects only relevant memories and stays under budget', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    seed(a);
    const { context, records, report } = a.compiler.compile({ goal: 'debug the postgres database connection', budget: 100 });
    assert.ok(report.tokensUsed <= 100);
    // The database fact should be selected; the frontend fact should not rank.
    assert.ok(records.some((r) => /Postgres/.test(r.content)), 'expected postgres fact');
    assert.ok(!records.some((r) => /React SPA/.test(r.content)), 'frontend fact should not match');
    assert.match(context, /\[semantic\]/);
  } finally {
    cleanup(root);
  }
});

test('baseline > actual: the compiler avoids tokens', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    seed(a);
    const { report } = a.compiler.compile({ goal: 'postgres', budget: 50 });
    assert.ok(report.baselineTokens > report.tokensUsed, 'baseline should exceed compiled tokens');
  } finally {
    cleanup(root);
  }
});

test('conflict resolution keeps the higher-salience claim', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    a.memory.remember({ tier: 'project', content: 'Deploy target is the OLD staging server.', key: 'deploy.target', salience: 0.3, tags: ['deploy'] });
    a.memory.remember({ tier: 'project', content: 'Deploy target is the NUC via deploy-nuc.', key: 'deploy.target', salience: 0.9, tags: ['deploy'] });
    const { records, report } = a.compiler.compile({ goal: 'where do we deploy', tags: ['deploy'], budget: 200 });
    assert.equal(report.conflicts.length, 1, 'one conflict recorded');
    assert.ok(records.some((r) => /NUC/.test(r.content)), 'kept higher-salience claim');
    assert.ok(!records.some((r) => /OLD staging/.test(r.content)), 'dropped lower-salience claim');
  } finally {
    cleanup(root);
  }
});

test('deduplicates identical content', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    a.memory.remember({ tier: 'semantic', content: 'The sync script writes directly to Postgres.', tags: ['sync'] });
    a.memory.remember({ tier: 'semantic', content: 'The sync script writes directly to Postgres.', tags: ['sync'] });
    const { report } = a.compiler.compile({ goal: 'sync script postgres', budget: 500 });
    assert.ok(report.droppedDuplicates >= 1, 'a duplicate should be dropped');
    assert.equal(report.keptCount, 1);
  } finally {
    cleanup(root);
  }
});

test('long records are compressed to fit the budget', () => {
  const root = tmpRoot();
  try {
    const a = createAgentOS({ root });
    const long = 'Sync detail. ' + 'The scheduler retries until CoServ posts data. '.repeat(30);
    a.memory.remember({ tier: 'procedural', content: long, tags: ['sync'] });
    const { report, records } = a.compiler.compile({ goal: 'sync scheduler coserv retries', budget: 40 });
    assert.ok(report.tokensUsed <= 40);
    if (records.length) assert.ok(report.compressedRecords >= 1, 'expected compression');
  } finally {
    cleanup(root);
  }
});
