---
name: product-overview
description: Use when someone new to Dignity Index Gate needs to understand what it does and where its capabilities live, because the surface area is wider than one README can convey.
metadata:
  version: 1.1.0
---

# Dignity Index Gate overview

## When to use this

You are orienting yourself and need the map, not the detail.

## The one idea

Every capability is a **Tool** registered in exactly one registry. The CLI, the web app, the MCP
server and every channel adapter are thin transports over that registry. There is no second code
path — see [ADR 0001](../../../docs/adr/0001-narrow-waist.md).

## What the gate actually decides

A **dignity index** 0–100 from six harm classes, and a **state transition** the gate will or will
not permit. Both are computed by a pure Python function, never by a model:

| op                 | purpose                                                 |
| ------------------ | ------------------------------------------------------- |
| `gate_score`       | index, band, components, blocking and advisory findings |
| `gate_transitions` | legal and refused edges out of a state                  |
| `gate_advance`     | attempt one transition; receipt or refusal              |
| `gate_board`       | every case grouped by state                             |
| `gate_matrix`      | the transition table itself                             |
| `load_declaration` | fetch a real declaration from the corpus                |

The four refusal codes are `TRANSITION_ILLEGAL`, `MISSING_EVIDENCE`, `INDEX_BELOW_FLOOR` and
`BLOCKING_FINDINGS`.

## Steps

1. Run `dignityindex-gate doctor` — it probes the engine over a real subprocess, not a constant.
2. Run `dignityindex-gate tools --json` — the authoritative capability list.
3. Run `dignityindex-gate board` — the review board, with a real index per case.
4. Read `docs/architecture.md` for the narrow waist, the state machine and the index weights.
5. Read `docs/adr/0005-refusal-is-a-result.md` before changing any error path.

## Where capability belongs

In order of preference. Adding to the core registry is the _last_ option, not the first:

1. Extend an existing tool
2. Add a CLI command plus a skill
3. Add a service-gated tool with a `check_fn`
4. Add a plugin
5. Add an MCP server tool to the catalog
6. Add a new core tool

## The data rule

`corpus/declarations.json` is hand-maintained **facts**. Everything computed from it lives in
`apps/web/lib/generated/board.json` and is produced by the engine:

```bash
npm run generate:web-data        # regenerate after editing the corpus
npm run check:generated-web-data # prove the committed file still matches the engine
```

The generator refuses to write a corpus whose recorded states the engine would not accept.

## Verify

`dignityindex-gate doctor` exits 0 and `dignityindex-gate board` prints an index per case.
