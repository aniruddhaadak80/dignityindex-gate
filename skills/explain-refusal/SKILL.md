---
name: explain-refusal
description: Use when someone is unhappy that the gate blocked a deployment and asks you to justify or overturn it, because the answer must cite a table row rather than an opinion.
metadata:
  version: 1.0.0
---

# Explain a refusal

## When to use this

A stakeholder wants the block lifted. Your job is to make the block legible, not to argue past
it.

## The four refusal codes

| Code                 | Means                                   | What actually fixes it                                                       |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `TRANSITION_ILLEGAL` | the edge is not in the table            | nothing in the declaration — this is a policy question, and the answer is no |
| `MISSING_EVIDENCE`   | a mandatory harm class has no reference | attach the document under `evidence` for that harm class                     |
| `INDEX_BELOW_FLOOR`  | below 50 to adjudicate, 60 to release   | change a fact, or accept a lower score and document why                      |
| `BLOCKING_FINDINGS`  | a blocking finding is open              | clear the finding; see the codes below                                       |

## Steps

1. Reproduce the refusal exactly — `dignityindex-gate run gate_transitions '{"declaration": …,
"state": "draft"}'` and quote the `message` field verbatim.

2. Name the specific finding, not the index. `NO_APPEAL` in a hiring system is a fact about the
   deployment. "The index is 48" is a number the stakeholder cannot act on.

3. Separate the two kinds of finding. `blocking` prevents release. `advisory` is recorded and
   does not. Saying otherwise is how a review loses the room.

4. Show the arithmetic — `dignityindex-gate run gate_score` returns each component's score,
   weight and rationale. The index is a weighted mean of those, so any of them can be disputed
   individually.

5. If the declaration is genuinely accurate and still blocked, the honest answer is that the
   policy forbids it. `dignityindex-gate run gate_matrix '{}'` prints the floors; changing a
   floor is a change to the product, not to the case.

## What not to do

- Do not recompute the index by hand, and do not ask a model to estimate it. The point of the
  gate is that the number is reproducible.
- Do not split one case into two to get each under a floor. The gate counts cases, and the
  arithmetic still exposes it.
- Do not describe a refusal as a bug unless `dignityindex-gate doctor` disagrees with the same
  declaration.

## Verify

`dignityindex-gate run gate_advance` with the same arguments returns the same receipt id. The
refusal is deterministic, which is what makes it arguable.
