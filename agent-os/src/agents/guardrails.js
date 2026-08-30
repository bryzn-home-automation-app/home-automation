'use strict';

/**
 * Approval guards — the playbook's rule for where the human line sits:
 *
 *   "Set the approval line by reversibility: bots finish anything undoable on
 *    their own, and anything external, financial, or permanent waits for you."
 *
 * `reversibilityGuard()` returns a `needsApproval(task, agent)` predicate for the
 * Orchestrator. A task needs approval when it looks irreversible (external,
 * financial, or permanent) OR when it matches something in the routed agent's
 * charter `neverWithoutAsking` list. Everything else the bot finishes on its own.
 */

const CATEGORIES = {
  external: [
    'send', 'email', 'e-mail', 'post', 'publish', 'tweet', 'dm', 'message', 'notify',
    'deploy', 'release', 'ship', 'merge', 'push to', 'force-push', 'force push',
    'submit', 'sign', 'share externally', 'go live',
  ],
  financial: [
    'pay', 'payment', 'purchase', 'buy', 'charge', 'invoice', 'refund',
    'transfer funds', 'wire', 'subscribe', 'cancel subscription', 'spend',
  ],
  permanent: [
    'delete', 'drop table', 'drop database', 'remove', 'wipe', 'destroy', 'erase',
    'overwrite', 'truncate', 'revoke', 'rotate credential', 'rotate key',
    'reset production', 'purge',
  ],
};

/**
 * @param {object} [options]
 * @param {object} [options.categories] override/extend the keyword categories
 * @param {boolean} [options.useCharter=true] also consult agent.charter.neverWithoutAsking
 * @returns {(task, agent)=>boolean}
 */
function reversibilityGuard(options = {}) {
  const categories = { ...CATEGORIES, ...(options.categories || {}) };
  const useCharter = options.useCharter !== false;
  const guard = (task, agent) => classifyReversibility(task, agent, { categories, useCharter }).needsApproval;
  guard.classify = (task, agent) => classifyReversibility(task, agent, { categories, useCharter });
  return guard;
}

/**
 * Explain WHY a task is or isn't auto-approvable.
 * @returns {{ needsApproval:boolean, reversible:boolean, category:?string, matched:string[] }}
 */
function classifyReversibility(task, agent, opts = {}) {
  const categories = opts.categories || CATEGORIES;
  const useCharter = opts.useCharter !== false;
  const text = String((task && task.goal) || task || '').toLowerCase();

  const matched = [];
  let category = null;
  for (const [cat, phrases] of Object.entries(categories)) {
    for (const p of phrases) {
      if (text.includes(p)) {
        matched.push(p);
        if (!category) category = cat;
      }
    }
  }

  // Charter escalations: the routed agent's own "never without asking" list.
  if (useCharter && agent && agent.charter && Array.isArray(agent.charter.neverWithoutAsking)) {
    for (const rule of agent.charter.neverWithoutAsking) {
      const r = String(rule).toLowerCase();
      // Match if the task text overlaps the rule's salient words.
      const salient = r.split(/\s+/).filter((w) => w.length >= 4);
      if (salient.length && salient.every((w) => text.includes(w))) {
        matched.push(`charter:${rule}`);
        if (!category) category = 'charter';
      }
    }
  }

  const needsApproval = matched.length > 0;
  return { needsApproval, reversible: !needsApproval, category, matched };
}

module.exports = { reversibilityGuard, classifyReversibility, CATEGORIES };
