'use strict';

const { extractKeywords } = require('./MemoryEngine');
const { jaccard } = require('../context/ContextCompiler');

/**
 * Memory admission policy — the gate that keeps physical memory small and
 * high-signal. Not every Claude response deserves permanent storage.
 *
 * The litmus test (from the operator's policy):
 *   "Would retrieving this later materially improve an agent's ability to
 *    perform a task?"  If not, it belongs in episodic history or is discarded.
 *
 * The policy sorts a candidate into one of three outcomes:
 *   - promote:  material, durable knowledge → its intended durable tier
 *   - episodic: has substance but is transient / uncertain → episodic history
 *   - discard:  filler or an exact duplicate → dropped entirely
 *
 * Durable tiers (semantic/project/procedural/preference) face a HIGH bar; the
 * episodic and working tiers face a LOW bar (they are *meant* to hold the
 * transient stuff), so proposing an episodic write only ever risks a filler
 * discard, never a downgrade.
 *
 * It is deterministic by default and auditable (every decision lists reasons +
 * a materiality score). A host may inject a `classifier(candidate, ctx)` to
 * override or augment the heuristic (e.g. an LLM judge).
 */

const DURABLE_TIERS = new Set(['semantic', 'project', 'procedural', 'preference']);

// --- Reason codes (what the policy detected) --------------------------------
const REASON = {
  FILLER: 'filler',                    // greeting / acknowledgement / no substance
  REASONING: 'temporary-reasoning',    // one-off intermediate thought / narration
  SPECULATION: 'low-confidence',       // hedged, uncertain
  DUPLICATE: 'duplicate-fact',         // already in durable memory
  STALE_STATE: 'stale-task-state',     // transient status, not durable knowledge
  NOT_MATERIAL: 'not-material',        // fails the "would this help later?" test
  MATERIAL: 'material',                // passes it
};

// Phrases that mark content as conversational filler.
const FILLER_RE = /^(thanks?|thank you|ok(ay)?|sure|got it|sounds good|great|perfect|no problem|you're welcome|will do|done|yep|yeah|hi|hello|hey)[.! ]*$/i;

// Content composed ENTIRELY of these reads as acknowledgement/filler, however
// the words are punctuated ("Got it, sounds good", "ok thanks!").
const FILLER_WORDS = new Set(
  ('thanks thank you ok okay sure got it sounds good great perfect no problem youre welcome will do done ' +
    'yep yeah yes nope hi hello hey cool nice awesome np ty please alright right fine')
    .split(/\s+/)
);

function isAllFiller(content) {
  const words = content.toLowerCase().replace(/[^a-z]+/g, ' ').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => FILLER_WORDS.has(w));
}

// Markers of temporary reasoning / narration of intent (present-tense "I'm doing X now").
const REASONING_RE = /\b(let me|let's|i'?ll (now|go|start|check|look|try)|i'?m going to|i am going to|first,? i|next,? i|then i'?ll|i need to (check|look|see|verify)|thinking (about|through)|let me think|i should probably|as a next step)\b/i;

// Hedge markers of low-confidence speculation.
const HEDGE_RE = /\b(maybe|perhaps|probably|possibly|might( be)?|could be|i think|i guess|i believe|not (sure|certain)|seems? (like|to)|apparently|presumably|likely|it'?s possible|my guess)\b/gi;

// Markers of transient task state (belongs in working/episodic, never durable).
const STALE_STATE_RE = /\b(currently (working|running)|in progress|todo|to-do|to do:|next step is|still (need|working)|waiting (for|on)|about to|now i'?m|for now|temporarily|placeholder)\b/i;

// Signals of durable, material knowledge.
const MATERIAL_RE = /\b(is|are|runs? on|listens? on|uses?|lives? (in|at)|located|stored?|persists?|configured|defaults? to|must|must not|never|always|requires?|depends? on|maps? to|defined in|returns?|expects?|port|path|endpoint|schema|table|column|key|token|env(ironment)? variable)\b/i;

// Concrete identifier tokens (paths, ports, snake_case, camelCase, ALLCAPS, versions).
const IDENTIFIER_RE = /([a-z0-9_]+\/[a-z0-9_./-]+|\b[a-z]+[A-Z][a-zA-Z]+\b|\b[a-z]+_[a-z_]+\b|\b[A-Z]{2,}\b|:\d{2,5}\b|\bv?\d+\.\d+(\.\d+)?\b|\.\w{2,4}\b)/;

class MemoryPolicy {
  constructor(config = {}, options = {}) {
    const p = (config.policy) || {};
    this.minKeywords = p.minKeywords != null ? p.minKeywords : 2;
    this.minWords = p.minWords != null ? p.minWords : 4;
    this.hedgeDensity = p.hedgeDensity != null ? p.hedgeDensity : 0.12; // hedges / words
    this.minConfidence = p.minConfidence != null ? p.minConfidence : 0.5;
    this.dedupeJaccard = p.dedupeJaccard != null ? p.dedupeJaccard : 0.85;
    this.promoteThreshold = p.promoteThreshold != null ? p.promoteThreshold : 2;
    // Optional host override: (candidate, ctx) => partial decision or null.
    this.classifier = options.classifier || null;
  }

  /**
   * @param {object} candidate  { content, tier?, key?, tags?, confidence?, source? }
   * @param {object} ctx        { existingDurable?: Array<record> }  for dedupe
   * @returns {{ decision, tier, reasons, materiality, confidence }}
   */
  evaluate(candidate, ctx = {}) {
    const content = String(candidate.content || '').trim();
    const proposedTier = candidate.tier || 'semantic';
    const isDurableTarget = DURABLE_TIERS.has(proposedTier);
    const reasons = [];

    // Empty / filler is always discarded, whatever the tier.
    const words = content.split(/\s+/).filter(Boolean);
    const keywords = extractKeywords(content);
    if (!content || FILLER_RE.test(content) || isAllFiller(content) || words.length < this.minWords || keywords.length < 1) {
      reasons.push(REASON.FILLER);
      return decision('discard', null, reasons, 0, candidate.confidence);
    }

    // Exact / near duplicate against existing durable memory → nothing new to store.
    const existing = ctx.existingDurable || [];
    const dup = existing.find(
      (r) => r.content === content || jaccard(r.keywords || extractKeywords(r.content), keywords) >= this.dedupeJaccard
    );
    if (dup && isDurableTarget) {
      reasons.push(REASON.DUPLICATE);
      return decision('discard', null, reasons, 0, candidate.confidence, { duplicateOf: dup.id });
    }

    // Episodic / working targets have a low bar: past the filler check, admit.
    if (!isDurableTarget) {
      return decision('promote', proposedTier, [REASON.MATERIAL], 1, candidate.confidence);
    }

    // ---- Durable target: apply the high bar. ----
    let materiality = 0;
    if (candidate.key) materiality += 2;                       // a keyed fact is inherently durable
    if (MATERIAL_RE.test(content)) materiality += 1;
    if (IDENTIFIER_RE.test(content)) materiality += 1;
    if ((candidate.tags || []).some((t) => /decision|preference|convention|rule|fact/i.test(t))) materiality += 1;
    if (keywords.length >= this.minKeywords) materiality += 1;

    const soft = []; // reasons that downgrade to episodic rather than discard

    if (REASONING_RE.test(content)) {
      materiality -= 1;
      soft.push(REASON.REASONING);
    }
    if (STALE_STATE_RE.test(content)) {
      materiality -= 2;
      soft.push(REASON.STALE_STATE);
    }
    const hedges = (content.match(HEDGE_RE) || []).length;
    const explicitLowConf = candidate.confidence != null && candidate.confidence < this.minConfidence;
    if (hedges / words.length > this.hedgeDensity || explicitLowConf) {
      materiality -= 1;
      soft.push(REASON.SPECULATION);
    }

    // Host override gets the final say (can force any decision).
    if (this.classifier) {
      const override = this.classifier(candidate, { ...ctx, materiality, reasons: soft, keywords });
      if (override && override.decision) {
        return decision(
          override.decision,
          override.decision === 'promote' ? proposedTier : override.decision === 'episodic' ? 'episodic' : null,
          override.reasons || soft,
          override.materiality != null ? override.materiality : materiality,
          candidate.confidence
        );
      }
    }

    if (materiality >= this.promoteThreshold && soft.length === 0) {
      return decision('promote', proposedTier, [REASON.MATERIAL], materiality, candidate.confidence);
    }

    // Has substance but failed the durable bar → keep it in episodic history,
    // exactly as the policy prescribes ("remain in episodic history or discard").
    if (materiality > 0 || soft.length) {
      return decision('episodic', 'episodic', soft.length ? soft : [REASON.NOT_MATERIAL], materiality, candidate.confidence);
    }

    reasons.push(REASON.NOT_MATERIAL);
    return decision('discard', null, reasons, materiality, candidate.confidence);
  }
}

function decision(dec, tier, reasons, materiality, confidence, extra = {}) {
  return { decision: dec, tier, reasons, materiality, confidence: confidence != null ? confidence : null, ...extra };
}

module.exports = { MemoryPolicy, REASON, DURABLE_TIERS };
