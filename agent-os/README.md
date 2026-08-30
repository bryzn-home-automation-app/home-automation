# @agent-os/core

A portable **Agent Operating System for Claude**: physical memory, agent
orchestration, learnable skills, context compilation, and token-efficiency
measurement.

> **Memory can be large. Context should be small. The model is not the database.**

The Agent OS keeps a large, long-lived knowledge base *outside* the context
window and **compiles** a small, task-shaped context on demand — so Claude
operates over deep history without paying to re-read all of it every turn.

- **Zero runtime dependencies.** Pure Node (≥18). Nothing to install.
- **Portable.** All state lives under one `.agent-os/` directory. Drop it into
  any repo; it keeps that repo's memory beside it. No database, no global state.
- **LLM-agnostic.** Claude is injected as a `modelClient`, so the core is fully
  deterministic and unit-tested with a mock.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full design.

---

## Quickstart

```bash
cd agent-os
npm test          # 19 tests, no network
npm run demo      # end-to-end run with a mock model
```

### Library

```js
const { createAgentOS } = require('@agent-os/core'); // or require('./agent-os/src')

const ai = createAgentOS({
  root: '.agent-os',        // physical memory location (default: <cwd>/.agent-os)
  model: 'claude-sonnet',
  modelClient,              // your Claude call (see below); optional for dry runs
});

// 1. Write to physical memory (this can grow to thousands of records).
ai.memory.remember({ tier: 'semantic', content: 'Postgres runs on port 5432.', tags: ['db'] });
ai.memory.remember({ tier: 'project',  content: 'Deploy via deploy-nuc.', key: 'deploy.target', salience: 0.9 });

// 2. Run a request — orchestrator plans, routes, executes, consolidates, measures.
const result = await ai.run(
  'research the database\nand then verify the deploy target',
  { tags: ['db', 'deploy'] }
);

console.log(result.summary);        // { tokensAvoided, reductionPct, costAvoidedUsd, ... }
```

### Just the compiler

```js
const { context, report } = ai.compiler.compile({ goal: 'debug the postgres connection', budget: 2000 });
// context: the small compiled string to hand to Claude
// report:  { baselineTokens, tokensUsed, keptCount, conflicts, ... }
```

### CLI

```bash
node bin/agent-os.js remember semantic "Postgres runs on 5432" --tags db
node bin/agent-os.js consider semantic "Thanks, will do!"   # → discard (filler)
node bin/agent-os.js compile "debug the database" --budget 1500
node bin/agent-os.js run "research the sync and verify auth"
node bin/agent-os.js stats
node bin/agent-os.js measure     # summarize measurement history
node bin/agent-os.js skills
```

---

## Build & scale your agent team

You don't need 20 bots. The pattern scales down cleanly, and the Agent OS gives you
a primitive for each step of the playbook:

1. **Start with one general-purpose bot** as your future Chief of Staff; give it
   small, verifiable errands. → `createAgentOS({ orchestrator: { specialists: STARTER_ROSTER } })`
2. **Add your first specialist** for whatever eats your week, with a **charter**:
   what it owns, what good looks like, what it never does without asking.
   → each agent def carries `charter: { owns, goodLooksLike, neverWithoutAsking }`
3. **Connect only the tools that specialist needs** — you can widen later, but you
   can't easily narrow a beta's blast radius. → the `modelClient` / `stepRunner`
   you inject is the only surface a specialist can touch.
4. **Teach one recurring, multi-tool task by demonstration**, then make it a
   routine. → `skills.learnFromDemonstration(...)` then `routines.fromSkill(id, { schedule })`
5. **Set the approval line by reversibility** — bots finish anything undoable;
   external/financial/permanent waits for you. → `createAgentOS({ approvalByReversibility: true })`
6. **Review weekly**, then prune routines you would not miss.
   → `review.render()` and `routines.prune(id)`

```js
// Two bots, one routine, a clear approval line.
const { createAgentOS, STARTER_ROSTER } = require('@agent-os/core');

const ai = createAgentOS({
  modelClient,
  approvalByReversibility: true,                 // deploy/delete/send/pay → waits for you
  orchestrator: {
    specialists: STARTER_ROSTER,                 // chief-of-staff + engineering
    approver: async ({ task }) => askHuman(task) // your approval UI
  },
});

const skill = ai.skills.learnFromDemonstration({ name: 'Nightly sync', steps: [...] });
ai.routines.fromSkill(skill.id, { name: 'Nightly sync', schedule: { intervalMs: 86_400_000 } });

// ...a week later:
console.log(ai.review.render());                 // what each bot ran / produced / skipped
```

From the CLI:

```bash
agent-os routines add "Nightly research" "research the codebase" --every 86400000
agent-os routines due                 # what should fire now
agent-os routines run <id>
agent-os review                       # weekly report + prune candidates
```

## Wiring in the real Claude

The `modelClient` is any async function returning `{ text, usage }`:

```js
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic();

const modelClient = async ({ messages }) => {
  const system = messages.find((m) => m.role === 'system')?.content;
  const rest = messages.filter((m) => m.role !== 'system');
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',            // set to your target model id
    max_tokens: 1024,
    system,
    messages: rest.map((m) => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content })),
  });
  return {
    text: res.content.map((b) => (b.type === 'text' ? b.text : '')).join(''),
    usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
  };
};

const ai = createAgentOS({ modelClient });
```

> Model ids and pricing move over time — set `model` and the `pricing` map in
> config to match current published values for your target model.

---

## Memory tiers

| Tier | Use it for |
|------|------------|
| `semantic` | durable facts ("the API is on 8080") |
| `episodic` | events / history ("sync failed on 2026-08-30") |
| `procedural` | how-to knowledge, links to skills |
| `project` | project state & decisions |
| `preference` | operator/user preferences |
| `working` | short-lived scratch (auto-pruned by TTL) |

Records decay in salience over time and are reinforced when used, so relevance is
self-maintaining. Records that share a conflict `key` are resolved to a single
winner at compile time (highest salience, then newest), with the conflict logged.

## What should *not* become memory

Not every Claude response deserves permanent storage. The **admission policy**
gates durable memory with one question:

> *"Would retrieving this later materially improve an agent's ability to perform a task?"*
> If not, it stays in episodic history or is discarded.

Use `memory.consider()` (not `remember()`) for Claude-generated content — it sorts
each candidate into **promote** (durable), **episodic** (transient but useful), or
**discard** (filler / duplicate):

```js
ai.memory.consider({ tier: 'semantic', content: 'The backend runs on port 8080.' });
// → { decision: 'promote',  tier: 'semantic',  reasons: ['material'] }

ai.memory.consider({ tier: 'semantic', content: 'Thanks, sounds good!' });
// → { decision: 'discard',  tier: null,        reasons: ['filler'] }

ai.memory.consider({ tier: 'semantic', content: 'Let me go check the scheduler next.' });
// → { decision: 'episodic', tier: 'episodic',  reasons: ['temporary-reasoning'] }
```

Kept out of durable memory: conversational filler and exact duplicates
(**discarded**); temporary reasoning, one-off intermediate thoughts, low-confidence
speculation, and stale task state (**downgraded to episodic**). Durable tiers face
this bar; `episodic`/`working` face only the filler check — they exist to hold the
transient stuff. Every verdict is auditable (`reasons` + `materiality`), tunable via
the `policy` config block, and overridable with a host `classifier` (e.g. an LLM
judge or a redaction rule). The consolidator routes all learned facts through this
gate automatically. From the CLI: `agent-os consider <tier> "<content>"`.

---

## Configuration

Pass options to `createAgentOS()` or drop a `.agent-os/config.json`:

```jsonc
{
  "contextTokenBudget": 4000,     // max tokens the compiler may assemble per task
  "recencyHalfLifeDays": 30,      // how fast recency weighting fades (0 = off)
  "workingTtlMs": 21600000,       // working-memory lifetime (6h)
  "model": "claude-sonnet",
  "tierWeights": { "working": 1.3, "preference": 1.2 },
  "pricing": { "claude-sonnet": { "input": 3.0, "output": 15.0 } },
  "policy": {                     // memory admission gate (see below)
    "minWords": 4,
    "minKeywords": 2,
    "hedgeDensity": 0.12,         // hedges / words above this = speculation
    "minConfidence": 0.5,
    "dedupeJaccard": 0.85,        // keyword overlap at/above this = duplicate
    "promoteThreshold": 2         // materiality needed for a durable tier
  }
}
```

---

## Layout

```
agent-os/
├── src/
│   ├── index.js                    createAgentOS() — wires everything together
│   ├── config.js                   config resolution, tier list, pricing
│   ├── memory/                     MemoryEngine + file store + MemoryPolicy (admission gate)
│   ├── context/                    ContextCompiler (retrieve→…→budget)
│   ├── skills/                     SkillsEngine + Skill (learn-from-demonstration)
│   ├── agents/                     Orchestrator, Agent (+ charter), registry, guardrails
│   ├── routines/                   RoutineEngine (demonstrated task + schedule/trigger)
│   ├── review/                     ReviewEngine (weekly: ran / produced / skipped / prune)
│   ├── consolidator/               MemoryConsolidator (close the loop)
│   ├── measurement/                MeasurementEngine (baseline vs actual)
│   └── util/                       tokens, ids, logger
├── bin/agent-os.js                 CLI
├── examples/demo.js                end-to-end demo (mock model)
├── test/                           node:test suite (19 tests, no network)
├── ARCHITECTURE.md
└── README.md
```

`.agent-os/` (the runtime memory, skills, and measurement log) is git-ignored by
default — it's per-machine state, not source.

---

## License

MIT.
