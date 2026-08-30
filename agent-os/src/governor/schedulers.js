'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Scheduler adapters for the Usage Governor's `scheduler(resumeAt, payload)`
 * seam. They decouple "book a resume for later" from whatever actually wakes the
 * process back up (cron, an `at` job, a Claude Code scheduled trigger, a cloud
 * timer). The governor calls the adapter when it stops; the adapter records the
 * request in a form the waker understands.
 */

/**
 * Write the resume request to a JSON file an external waker polls. Pairs with
 * `readResumeRequest` / `clearResumeRequest`. The waker (a cron job, or a Claude
 * Code trigger) reads the file at/after `resumeAt` and runs `resumeGoverned()`.
 */
function fileScheduler(filePath, opts = {}) {
  return async (resumeAt, payload) => {
    const request = {
      resumeAt: new Date(resumeAt).toISOString(),
      requestedAt: new Date(opts.now || Date.now()).toISOString(),
      command: opts.command || 'agent-os governor resume',
      payload,
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(`${filePath}.tmp`, JSON.stringify(request, null, 2));
    fs.renameSync(`${filePath}.tmp`, filePath);
    return { scheduledVia: 'file', filePath, resumeAt: request.resumeAt };
  };
}

function readResumeRequest(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function clearResumeRequest(filePath) {
  fs.rmSync(filePath, { force: true });
}

/**
 * Wrap any async function as a scheduler — the general seam for a host that can
 * book a timer directly (e.g. an SDK/MCP call that creates a scheduled trigger).
 * The function receives (resumeAtMs, payload) and may return anything.
 */
function callbackScheduler(fn) {
  return async (resumeAt, payload) => {
    const info = await fn(resumeAt, payload);
    return { scheduledVia: 'callback', resumeAt: new Date(resumeAt).toISOString(), info };
  };
}

module.exports = { fileScheduler, readResumeRequest, clearResumeRequest, callbackScheduler };
