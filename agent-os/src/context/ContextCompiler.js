'use strict';

const { estimateTokens } = require('../util/tokens');
const { extractKeywords } = require('../memory/MemoryEngine');
const log = require('../util/logger');

/**
 * The Context Compiler turns a large physical memory into a small, task-shaped
 * context. This is where the token savings come from.
 *
 * Pipeline: retrieve -> rank -> deduplicate -> resolve conflicts -> compress
 * -> budget. Every stage is deterministic and reports what it did, so the
 * Measurement Engine can attribute savings and a human can audit the selection.
 */
class ContextCompiler {
  constructor(config, memory) {
    this.config = config;
    this.memory = memory;
  }

  /**
   * @param {object} task - { goal, tags?, tierWeights?, budget? }
   * @returns {{ context:string, messages:Array, records:Array, report:object }}
   */
  compile(task) {
    const started = Date.now();
    const goal = String(task.goal || '').trim();
    const budget = task.budget || this.config.contextTokenBudget;
    const queryTerms = new Set([
      ...extractKeywords(goal),
      ...(task.tags || []).map((t) => String(t).toLowerCase()),
    ]);

    // 1. RETRIEVE — pull every candidate; scoring narrows it, not a pre-filter,
    //    so nothing relevant is dropped before it can be ranked.
    const candidates = this.memory.all();
    const totalMemoryTokens = candidates.reduce((s, r) => s + estimateTokens(r.content), 0);

    // 2. RANK — lexical overlap x tier weight x recency x salience.
    const tierWeights = { ...this.config.tierWeights, ...(task.tierWeights || {}) };
    const scored = candidates
      .map((r) => ({ record: r, score: this._score(r, queryTerms, tierWeights) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    // 3. DEDUPLICATE — drop records whose content is identical or near-identical
    //    to a higher-ranked one already kept.
    const deduped = [];
    const seenHashes = new Set();
    let droppedDup = 0;
    for (const s of scored) {
      const h = s.record.hash;
      if (seenHashes.has(h)) {
        droppedDup++;
        continue;
      }
      const near = deduped.find((k) => jaccard(k.record.keywords, s.record.keywords) >= 0.9);
      if (near) {
        droppedDup++;
        continue;
      }
      seenHashes.add(h);
      deduped.push(s);
    }

    // 4. RESOLVE CONFLICTS — records sharing a `key` are competing claims about
    //    the same thing. Keep the winner (highest salience, then newest); the
    //    losers are recorded in the report rather than silently dropped.
    const byKey = new Map();
    const conflicts = [];
    const resolved = [];
    for (const s of deduped) {
      const key = s.record.key;
      if (!key) {
        resolved.push(s);
        continue;
      }
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, s);
        resolved.push(s);
      } else {
        const winner = this._preferred(existing.record, s.record);
        const loser = winner === existing.record ? s.record : existing.record;
        conflicts.push({ key, keptId: winner.id, dropped: loser.id });
        if (winner !== existing.record) {
          // Replace loser already in `resolved` with the new winner.
          const idx = resolved.indexOf(existing);
          if (idx !== -1) resolved[idx] = s;
          byKey.set(key, s);
        }
      }
    }

    // 5 + 6. COMPRESS + BUDGET — greedily fill the budget from the top; compress
    //    long records so more distinct facts fit before the budget is spent.
    const kept = [];
    let spent = 0;
    let droppedBudget = 0;
    let compressedCount = 0;
    for (const s of resolved) {
      const full = s.record.content;
      let text = full;
      let cost = estimateTokens(text);
      const remaining = budget - spent;
      if (remaining <= 0) {
        droppedBudget++;
        continue;
      }
      if (cost > remaining) {
        text = compress(full, remaining);
        const newCost = estimateTokens(text);
        if (newCost < cost) compressedCount++;
        cost = newCost;
        if (cost > remaining || text.trim().length === 0) {
          droppedBudget++;
          continue;
        }
      }
      kept.push({ ...s, text, compressed: text !== full, cost });
      spent += cost;
    }

    const contextBlocks = kept.map((k) => renderBlock(k.record, k.text));
    const context = contextBlocks.join('\n\n');
    const messages = this._toMessages(goal, context);

    const report = {
      goal,
      budget,
      tokensUsed: spent,
      baselineTokens: totalMemoryTokens + estimateTokens(goal),
      candidateCount: candidates.length,
      rankedCount: scored.length,
      keptCount: kept.length,
      droppedDuplicates: droppedDup,
      droppedForBudget: droppedBudget,
      compressedRecords: compressedCount,
      conflicts,
      keptIds: kept.map((k) => k.record.id),
      compileMs: Date.now() - started,
    };
    log.debug(`compile: kept ${kept.length}/${candidates.length} using ${spent}/${budget} tokens`);

    return { context, messages, records: kept.map((k) => k.record), report };
  }

  _score(record, queryTerms, tierWeights) {
    const kw = new Set(record.keywords || []);
    let overlap = 0;
    for (const t of queryTerms) if (kw.has(t)) overlap++;
    // Tag matches count double — they are explicit, human-supplied signals.
    const tagOverlap = (record.tags || []).filter((t) => queryTerms.has(String(t).toLowerCase())).length;
    const lexical = overlap + tagOverlap * 2;
    if (lexical === 0 && record.tier !== 'preference') return 0; // preferences are always eligible

    const tierWeight = tierWeights[record.tier] != null ? tierWeights[record.tier] : 1;
    const recency = this._recency(record);
    const salience = 0.5 + (record.salience || 0) * 0.5; // never fully zero out a match
    const base = Math.max(lexical, record.tier === 'preference' ? 0.5 : lexical);
    return base * tierWeight * recency * salience;
  }

  _recency(record) {
    const halfLife = this.config.recencyHalfLifeDays;
    if (!halfLife) return 1;
    const ageDays = (Date.now() - new Date(record.updatedAt || record.createdAt).getTime()) / 86400000;
    return Math.pow(0.5, ageDays / halfLife) * 0.5 + 0.5; // in [0.5, 1]
  }

  _preferred(a, b) {
    if ((b.salience || 0) !== (a.salience || 0)) return (b.salience || 0) > (a.salience || 0) ? b : a;
    return new Date(b.updatedAt) > new Date(a.updatedAt) ? b : a;
  }

  _toMessages(goal, context) {
    const system =
      'You are a specialist agent in an Agent OS. The following context was ' +
      'compiled from persistent memory specifically for this task. Treat it as ' +
      'authoritative background; if it conflicts with the task, prefer the task.';
    const user = context
      ? `# Compiled context\n${context}\n\n# Task\n${goal}`
      : `# Task\n${goal}`;
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }
}

/** Extractive compression: keep the highest-signal sentences within a budget. */
function compress(text, tokenBudget) {
  const sentences = String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 1) {
    // Single blob — hard truncate on a word boundary.
    const approxChars = Math.max(0, tokenBudget * 4 - 1);
    if (text.length <= approxChars) return text;
    return text.slice(0, approxChars).replace(/\s+\S*$/, '') + ' …';
  }
  const out = [];
  let used = 0;
  for (const s of sentences) {
    const c = estimateTokens(s);
    if (used + c > tokenBudget) break;
    out.push(s);
    used += c;
  }
  if (out.length === 0) return compress(sentences[0], tokenBudget);
  return out.join(' ') + (out.length < sentences.length ? ' …' : '');
}

function renderBlock(record, text) {
  const tag = `[${record.tier}${record.key ? ':' + record.key : ''}]`;
  return `${tag} ${text}`;
}

function jaccard(a = [], b = []) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

module.exports = { ContextCompiler, compress, jaccard };
