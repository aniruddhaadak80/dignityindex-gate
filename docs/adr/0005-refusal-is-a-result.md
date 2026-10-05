# ADR 0005 — A refused transition is a result, not an error

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

`gate_advance` can come back three ways: the transition is in the table and every guard passes;
the edge is absent from the table; or a guard fails on the facts. The second and third are the
interesting outcomes — they are the gate doing its job.

MCP draws a distinction that maps awkwardly onto this. A tool that throws returns an error
envelope. A tool that returns returns a normal result. So the choice is forced: is "this
deployment may not ship" a successful call with an unhappy payload, or a failure?

The tempting answer is to throw, because `ok: false` feels like a lie. It is not. Consider the
caller: an agent asking "may I release this?" is asking a question whose answer is often no. An
exception forces every caller into a try/catch to distinguish "the gate said no" from "the tool
broke", and the two are then handled identically, which is exactly the confusion worth avoiding.

## Decision

Three distinct outcomes, with three distinct shapes:

| Situation                      | Shape                                                    | MCP            |
| ------------------------------ | -------------------------------------------------------- | -------------- |
| Transition permitted           | `{ ok: true, receipt, error: null }`                     | normal result  |
| Edge absent, or a guard failed | `{ ok: false, receipt: null, error: { code, message } }` | normal result  |
| Input did not match the schema | throws `ValidationError`                                 | error envelope |

A refusal is an **answer**. Malformed input is a **fault**. `packages/cli` exits `0` for a
refusal and `1` for a fault, because those are different things for a script to branch on.

## Consequences

**Good**

- An agent reads `ok` and branches, without exception handling that conflates two failures.
- The refusal code is data, so it can be logged, counted and asserted on — which is how
  `evals/` would measure a gate's behaviour over time.
- `TRANSITION_ILLEGAL` and `MISSING_EVIDENCE` stay comparable across calls, because neither
  destroys the caller.

**Bad**

- A caller that ignores `ok` and reads `receipt` will crash on `null`. Mitigated by typing
  `receipt: Receipt | None`, which forces the check at compile time.
- Someone skimming the code can mistake a refusal for success. The four refusal codes are
  documented in `skills/explain-refusal/SKILL.md` precisely because this is easy to get wrong.

## Alternatives rejected

**Throw on every refusal.** Rejected: it collapses "the gate said no" into "the tool broke", and
an agent cannot branch on a policy outcome it can only catch.

**Return `ok: true` with the refusal buried in the payload.** Rejected: `ok` must mean the
transition happened. A `true` that means "no" is how a deployment ships by accident.
