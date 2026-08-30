'use strict';

/**
 * Token estimation utilities.
 *
 * The Agent OS never assumes a specific tokenizer is installed, so the default
 * estimator is a deterministic heuristic (~4 characters per token, the rule of
 * thumb for English text under the Claude/GPT BPE families). A more accurate
 * tokenizer can be injected anywhere a `countTokens` function is accepted.
 *
 * The whole system speaks in *estimated* tokens, so measurement is internally
 * consistent even when the exact production tokenizer differs slightly.
 */

const CHARS_PER_TOKEN = 4;

/**
 * Estimate the number of tokens in a string.
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : String(text);
  // Blend a char-based and a word-based estimate; punctuation-heavy or
  // whitespace-heavy text is handled more gracefully than chars/4 alone.
  const charEstimate = str.length / CHARS_PER_TOKEN;
  const wordEstimate = str.trim().length === 0 ? 0 : str.trim().split(/\s+/).length * 1.3;
  return Math.max(1, Math.ceil((charEstimate + wordEstimate) / 2));
}

/**
 * Estimate tokens for an array of chat messages ({role, content}), including a
 * small per-message overhead that mirrors real chat-format framing.
 * @param {Array<{role?:string, content:string}>} messages
 * @param {(t:string)=>number} [countTokens]
 * @returns {number}
 */
function estimateMessageTokens(messages, countTokens = estimateTokens) {
  if (!Array.isArray(messages)) return 0;
  const PER_MESSAGE_OVERHEAD = 4;
  return messages.reduce(
    (sum, m) => sum + PER_MESSAGE_OVERHEAD + countTokens(m && m.content ? m.content : ''),
    0
  );
}

module.exports = { estimateTokens, estimateMessageTokens, CHARS_PER_TOKEN };
