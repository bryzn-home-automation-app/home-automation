# Claude Agent OS — Architecture

**Status:** working reference implementation (v0.1.0)
**Core thesis:** *Memory can be large. Context should be small. The model is not the database.*

The Agent OS externalizes persistent memory and **compiles** a small, task-shaped
context on demand, so Claude can operate over a large, long-lived knowledge base
without paying the token cost of carrying its entire history every turn.

It is **portable and repo-agnostic**: zero runtime dependencies, pure Node, and all
state lives under a single `.agent-os/` directory you can drop into any project.

---

## 1. The pipeline

```
USER
 │
 ▼
ORCHESTRATOR  (Chief of Staff)                  src/agents/Orchestrator.js
 │   plan → route → guardrail/approval → execute → consolidate
 ├──────────────┬──────────────┐
 ▼              ▼              ▼
Engineering   Research        QA               src/agents/Agent.js + registry.js
 └──────────────┼──────────────┘
                ▼
          SKILLS ENGINE                         src/skills/SkillsEngine.js
                │   learn-from-demonstration, match, run
                ▼
          MEMORY ENGINE                         src/memory/MemoryEngine.js
                │   semantic · episodic · procedural · project · preference · working
                ▼
          CONTEXT COMPILER                      src/context/ContextCompiler.js
                │   retrieve → rank → dedupe → resolve conflicts → compress → budget
                ▼
             CLAUDE  (pluggable modelClient)
                │
        ┌───────┴───────┐
        ▼               ▼
     ACTIONS         RESULTS
        └───────┬───────┘
                ▼
       MEMORY CONSOLIDATOR                       src/consolidator/MemoryConsolidator.js
                │   reinforce used memories · record episode · promote facts
                │        └── through the ADMISSION POLICY (src/memory/MemoryPolicy.js):
                │            promote durable · downgrade to episodic · discard filler/dupes
                ▼
       MEASUREMENT ENGINE                        src/measurement/MeasurementEngine.js
                    baseline vs actual tokens · tokens avoided · cost · latency · quality
```

---

## 2. Components

### Memory Engine — physical memory
Durable storage outside the context window. Six tiers, each a different *kind* of
knowledge:

| Tier | What it holds | Bias |
|------|---------------|------|
| `semantic` | durable facts about the world / codebase | stable |
| `episodic` | time-stamped events and history | recency-weighted |
| `procedural` | how-to knowledge, pointers to skills | task-triggered |
| `project` | project-scoped state and decisions | project-weighted |
| `preference` | operator/user preferences | always eligible |
| `working` | ephemeral scratch for the current task | TTL-pruned |

Each record carries `keywords`, `tags`, `salience` (0–1), an optional conflict
`key`, `source`, timestamps, and access counters. Storage is one atomically-written
JSON file per tier under `.agent-os/memory/` — inspectable, versionable, portable.
Salience **decays** over time and is **reinforced** by use, so knowledge that keeps
proving useful floats up and stale knowledge sinks.

### Context Compiler — where the savings come from
Deterministic six-stage pipeline turning large memory into a small context:

1. **Retrieve** — every record is a candidate (scoring narrows, not a pre-filter).
2. **Rank** — `lexical overlap × tier weight × recency × salience`. Tag matches
   count double (explicit human signal); preferences stay eligible even without
   lexical overlap.
3. **Deduplicate** — drop content-identical and near-identical (Jaccard ≥ 0.9)
   records already covered by a higher-ranked one.
4. **Resolve conflicts** — records sharing a `key` are competing claims; keep the
   winner (highest salience, then newest), and *record* the losers in the report
   rather than dropping them silently.
5. **Compress** — extractive sentence selection / boundary-safe truncation so more
   distinct facts fit before the budget is spent. (Pluggable with an LLM summarizer.)
6. **Budget** — greedily fill up to `contextTokenBudget` from the top.

Every compile emits a `report` (kept vs. candidate counts, tokens used vs.
baseline, dropped duplicates, conflicts, compile time) so selection is auditable
and measurable.

### Memory admission policy — what is *not* allowed to become memory
Not every Claude response deserves permanent storage. The **admission policy**
(`src/memory/MemoryPolicy.js`) is the gate in front of durable memory. Its litmus
test is a single question:

> **"Would retrieving this later materially improve an agent's ability to perform a task?"**
> If not, it stays in episodic history or is discarded.

Every candidate is sorted into one of three outcomes:

| Outcome | Meaning | Goes to |
|---------|---------|---------|
| **promote** | material, durable knowledge | its intended durable tier |
| **episodic** | has substance but is transient/uncertain | episodic history (the low-bar catch-all) |
| **discard** | filler or an exact duplicate | dropped entirely |

What it keeps out of durable memory, and why each is caught:

| Rejected | Detected by | Result |
|----------|-------------|--------|
| conversational filler | acknowledgement phrases / all-filler-word content / too few words | **discard** |
| duplicate facts | exact content or keyword-Jaccard ≥ 0.85 vs. existing durable memory | **discard** |
| temporary reasoning / one-off intermediate thoughts | intent-narration markers ("let me…", "I'll now…", "next I…") | **episodic** |
| low-confidence speculation | hedge density over threshold, or an explicit low `confidence` | **episodic** |
| stale task state | status markers ("currently working on", "TODO", "next step is") | **episodic** |
| not material | fails to clear the materiality score for a durable tier | **episodic** or **discard** |

Durable tiers (semantic/project/procedural/preference) face this **high bar**;
`episodic` and `working` face only the filler check — they are *meant* to hold the
transient stuff. Materiality is scored from durable signals (a conflict `key`,
definitional/relational phrasing, concrete identifiers like ports/paths/`snake_case`,
decision/preference tags, keyword richness) minus penalties for the soft rejects
above. The gate is deterministic and every verdict lists its `reasons` + a
`materiality` score, so admission is fully auditable. A host may inject a
`classifier` (e.g. an LLM judge, or a redaction rule) that gets the final say.

The engine exposes this as `memory.consider(candidate)` — the path Claude output
should take. `memory.remember(candidate)` stays the unconditional low-level write
for deliberate, trusted inserts. The Memory Consolidator routes all extracted
facts through `consider()`, so learning never silently bloats durable memory.

### Skills Engine — reusable, learnable workflows
Skills are declarative JSON (name, trigger keywords, ordered steps) stored under
`.agent-os/skills/`. `learnFromDemonstration()` promotes an observed sequence of
steps into a first-class reusable skill — *teach it once, reuse it forever*.
Execution delegates each step to a host-provided `stepRunner`, so the same skill
works whether the executor is a shell, an HTTP client, or another agent.

### Orchestrator — Chief of Staff
Holds no domain knowledge; it coordinates. **Plan** a request into subtasks
(default heuristic planner, or inject an LLM planner) → **route** each to the
best-fit specialist by keyword overlap → **guardrail** (sensitive/irreversible
tasks pause for human approval; auto-deny by default) → **execute** → **consolidate**
(including skips, so the weekly review sees them). Specialists (Engineering /
Research / QA by default, fully replaceable) each bias the compiler's tier weights
toward the memories their role cares about.

### Charters — each agent's written mandate
Every agent carries a **charter**: `owns` (what it is responsible for),
`goodLooksLike` (the bar for a good result), and `neverWithoutAsking` (the actions
that must pause for a human). The charter is prepended to the agent's system
framing so the model operates inside its mandate, feeds the approval guard, and
surfaces in the weekly review. This is the playbook's *"write its charter: what it
owns, what good looks like, what it never does without asking."*

### Approval line by reversibility
`reversibilityGuard()` (`src/agents/guardrails.js`) implements *"bots finish
anything undoable on their own, and anything external, financial, or permanent
waits for you."* It flags a task when the goal matches an **external / financial /
permanent** action, or matches the routed agent's `neverWithoutAsking` charter
line. Reversible work is auto-approved; irreversible work goes to the `approver`
(auto-deny until a host wires one up — safe by default). Opt in with
`createAgentOS({ approvalByReversibility: true })`; every decision is explainable
via `classifyReversibility()` (category + matched phrases).

### Routines — a demonstrated task on a schedule or trigger
A **Routine** (`src/routines/RoutineEngine.js`) binds a unit of work — a learned
Skill or an Orchestrator request — to a firing condition: a `schedule`
(`{ intervalMs }`) and/or a `trigger` (a named event). This is the playbook's
*"teach one recurring, multi-tool task by demonstration and turn it into one
routine with a schedule or trigger."* The library has no daemon (it stays portable
and side-effect free); the host drives firing via `due(now, { event })` /
`runDue(...)`. Every run appends to a run log so the review can report it, and
`prune(id)` removes routines you would not miss.

### Weekly review
`ReviewEngine` (`src/review/ReviewEngine.js`) reconstructs the playbook's weekly
cadence — *"ask each bot what it ran, what it produced, and what it skipped, then
prune routines you would not miss"* — from records the system already keeps: the
Measurement log (ran + token/cost impact), episodic memory (produced + skipped),
and the Routine run log. It flags routines that did not fire in the window as
**prune candidates**. It only reports and recommends; pruning stays a human action.

### Usage Governor — stay inside the 5-hour window
`UsageGovernor` (`src/governor/UsageGovernor.js`) keeps long work inside a rolling
usage window (e.g. the 5-hour Claude session window) and resumes it automatically
when the window resets:

```
< conserve%   → normal    run freely
conserve–90%  → conserve   avoid starting large/irreversible work
≥ prepare%    → prepare    finish safe step → save state → stop gracefully
                           → schedule resume → (5h reset) → restore → continue
```

The live usage signal is **pluggable** because a running agent cannot read
Anthropic's server-side usage meter directly:

- **Default (self-tracking):** the governor accumulates the tokens it is told
  about (`record(usage)`) against a configurable `budgetTokens` and derives the
  fraction itself. No external meter required.
- **Injected probe:** if the host can read the real percentage (the Claude Code
  CLI surfaces it), pass `usageProbe: () => ({ fraction, resetAt })` and it takes
  over — the same thresholds and stop/resume flow run on real numbers.

`runGoverned(request)` executes subtasks one at a time; after each it records
usage and re-checks the phase. At the prepare threshold it finishes the current
(safe) step, writes a **resume checkpoint** (the remaining task queue) to disk,
stops, and calls the injected `scheduler(resumeAt, payload)` to book the resume.
Because the checkpoint is on disk, `resumeGoverned()` — running in a *fresh*
session after the window resets — restores the queue and continues automatically.
If called before the reset it reports the time remaining rather than resuming
early. The window auto-rolls once its reset time passes.

The `scheduler` seam is where this binds to a real environment: a one-shot timer
at `resumeAt`, a cron/`Routine`, or (in Claude Code on the web) a scheduled
trigger / wake-up that starts a new session which calls `resumeGoverned()`.

### Memory Consolidator — closing the loop
After each task: reinforce the salience of memories that were actually used, record
an **episodic** event of what happened, and (optionally) run a `factExtractor` to
promote durable facts into **semantic** memory. This is what makes the system
*learn* rather than merely retrieve.

### Measurement Engine — proving the thesis
For every task it compares the **baseline** (a naive agent dumping all of memory +
the task) against the **actual** compiled context:

```
tokensAvoided = baselineTokens − actualTokens
reductionPct  = tokensAvoided / baselineTokens
```

plus cost (configurable per-model pricing), latency, and an optional host-supplied
quality score. Every measurement appends to `.agent-os/measurements.jsonl` so
savings are tracked over time and auditable.

---

## 3. Why the LLM is pluggable

The Agent OS is the *operating system around* Claude, not a reimplementation of it.
The model is injected as a `modelClient`:

```js
async ({ messages, task, agent }) => ({ text, usage: { inputTokens, outputTokens } })
```

This keeps the whole system deterministic and unit-testable with a mock, and lets
you wire in the real Anthropic SDK — or any model — without touching the core.

---

## 4. Design principles

- **Portable first.** Zero dependencies, pure Node, one self-contained directory.
  Nothing is specific to any one repo.
- **Deterministic core.** Every non-model stage is deterministic and reported, so
  behavior is testable and savings are attributable.
- **Append-and-reinforce, don't overwrite.** Memory accretes; salience + decay +
  conflict resolution manage relevance instead of destructive edits.
- **Safe by default.** Guardrails auto-deny sensitive actions until a host wires up
  an approver; the logger is silent until asked.

---

## 5. Reference

Organizational structure (orchestrator + specialists, learned skills, guardrails,
human approval) is inspired by the "Grok Bot" workflow described by Coursiv
(<https://coursiv.io/blog/grok-bot>). That article's productivity/automation
percentages are **reported claims, not independently validated benchmarks**. This
project's contribution is the explicit **memory infrastructure** and
**context-efficiency measurement** layered on top of that organizational idea.
