---
name: gate-review
description: Use when an AI system that decides something about people needs a release verdict before it ships, because the gate returns a reproducible certificate rather than an opinion.
metadata:
  version: 1.0.0
---

# Run a gate review

## When to use this

A team is about to deploy a model that ranks, scores, screens, triages or approves people, and
nobody can say afterwards what was actually checked.

## Steps

1. List what is already filed — `dignityindex-gate cases` prints every corpus case with its
   current state, so you reuse a declaration rather than inventing one.

2. If the case is new, write its declaration into `corpus/declarations.json`. It is **facts
   only**: no narrative, no justification. The sections are `decision` (automated, humanInLoop,
   appealable, appealSlaHours), `data` (trainsOnPeople, proxies, specialCategories), `impact`
   (populationSize, reversible, monitors) and `evidence` (harmClass + ref).

3. Score it — `dignityindex-gate run gate_score '<declaration>'`. Read the six components, not
   just the total. A high index driven by `reversibility: 100` while `contestability` is 0 is a
   different decision from a balanced one.

4. Ask what is permitted — `dignityindex-gate run gate_transitions '{"declaration": …,
"state": "draft"}'`. The `refused` array is the useful half; each entry carries the code
   that refused it.

5. Attempt the transition — `dignityindex-gate run gate_advance '{"declaration": …, "from":
"draft", "to": "evidenced", "actor": "reviewer@board"}'`. `ok:false` is a normal answer, not
   a crash.

6. Regenerate the board — `npm run generate:web-data`, then commit the result.

## The state graph

`draft → evidenced → contested → remediated → adjudicated → released`, with `blocked` reachable
from anywhere and `blocked → draft` for a reopen. Read the authoritative table with
`dignityindex-gate run gate_matrix '{}'`.

## Verify

`dignityindex-gate doctor` exits 0, and `dignityindex-gate run gate_score` returns the same
index twice in a row. If it does not, the engine is impure and that is a bug worth reporting.
