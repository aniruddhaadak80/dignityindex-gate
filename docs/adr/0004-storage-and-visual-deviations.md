# ADR 0004 — Storage: Postgres was drawn, SQLite ships

- **Status:** Accepted
- **Date:** 2026-10-05

## Context

The novelty engine drew `storage: postgres` for this build. The seeded draw is the mechanism
that keeps consecutive products from colliding, so the coordinate was not chosen freely and
should not be silently swapped.

Shipping Postgres would require provisioning a hosted database and committing credentials that
point at it. Two project rules collide with that:

1. **No secrets, ever.** `check:no-secrets` fails the build on a committed key, and the rule
   exists because a leaked key in a public repository is a real incident, not a theoretical one.
2. **The deployed web app must render real product data.** A Vercel function with no reachable
   database renders an empty state, and an ethics board that shows nothing is not a demo.

A second consideration pointed the same way. The interesting data here — verdicts and receipts
— is **derived**. It is fully recomputable from `corpus/declarations.json` by a pure function.
The data that is genuinely not recomputable is the _adjudication ledger_: the append-only record
of which transitions were actually attempted and what the engine returned.

## Decision

Ship **SQLite** via `better-sqlite3`, WAL mode, numbered migrations, via `packages/memory`.

The ledger is a separate table with `BEFORE UPDATE` and `BEFORE DELETE` triggers that `RAISE(ABORT)`
with `adjudication_events is append-only`. Immutability is a property of the database, not a
convention that calling code is trusted to observe.

The seam for a Postgres adapter is `packages/memory`: nothing above it constructs a `Store`
except `packages/cli/src/doctor.ts`.

## Consequences

**Good**

- `npm install && doctor` works offline with no account, no key, no connection string.
- The deployed board renders real engine output, verified by
  `npm run check:generated-web-data`.
- One storage engine, so the migration story and the failure modes are the ones actually tested.
- The ledger's append-only guarantee is enforced by the engine, so a bug in calling code cannot
  rewrite history.

**Bad**

- Single-writer. Two adjudicators cannot write concurrently from two machines. Correct for the
  current deployment shape; wrong the moment a shared network store is needed.
- If verdicts ever become large enough to need querying across cases, the derived-data argument
  weakens and this ADR should be revisited rather than stretched.

## Alternatives rejected

**Commit a Postgres connection string.** Rejected: it violates the no-secrets rule outright, and
a rotated key breaks every deployment.

**Vercel Postgres with the key injected at build time.** Rejected for the first release: it adds
a provisioning step that fails closed, and it buys nothing while verdicts are recomputable. The
adapter seam above is the whole migration.

**Ship no persistence at all.** Rejected: the adjudication ledger is the part of this product
that cannot be regenerated, and an ethics product with no record of who decided what is not
credible.

## The visual deviations from the same draw

Recorded here for the same reason. The generated vector drew `split-pane-master-detail`,
`slate-amber` and `sohne-sohne-mono`. The previous ledger entry (`glosslab`) **shipped**
`split-pane-master-detail` and `slate-amber`, so keeping them would have made two consecutive
builds visually indistinguishable — which defeats the purpose of drawing them at random. And
Söhne is commercially licensed: an MIT repository cannot ship it.

| Axis              | Drawn                      | Shipped                       | Why                            |
| ----------------- | -------------------------- | ----------------------------- | ------------------------------ |
| `layoutSignature` | `split-pane-master-detail` | `three-column-with-inspector` | collides with `glosslab`       |
| `palette`         | `slate-amber`              | `deep-navy-coral`             | collides with `glosslab`       |
| `typePairing`     | `sohne-sohne-mono`         | `public-sans-roboto-mono`     | Söhne is commercially licensed |

Kept as drawn: `density: comfortable`, `radius: pill`, `motionSignature: count-up`.

Coral is reserved in the token file for exactly one meaning — a refusal. Nothing else in the
product is allowed to use it, which is what makes a blocked case legible in a screenshot.
