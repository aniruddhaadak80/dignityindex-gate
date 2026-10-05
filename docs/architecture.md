# Architecture

## The narrow waist

Every capability is a `Tool`. One registry. One interface. Four transports.

```
                    ┌───────────────┐
   CLI ────────────▶│               │
   Web ────────────▶│  ToolRegistry │──▶ packages/memory  (SQLite, WAL, FTS, ledger)
   MCP server ─────▶│               │
   Channel ────────▶└───────────────┘
                           │
                           └──▶ services/engine  (pure Python, stdin/stdout)
```

The CLI, the web app, the MCP server, and the channel adapters are transports. None of them
contains product logic. If one needs a behaviour, that behaviour belongs in a tool.

## Invariants

1. **Tools are stateless.** State lives in `packages/memory`, addressed through the context.
2. **Input is validated before the handler runs.** Never after, never partially.
3. **Permissions are declared, not assumed.** A tool that touches more than it declares is a bug.
4. **Duplicate tool names throw**, naming both registrants. A silent overwrite is an
   undebuggable product bug.
5. **No cross-package deep imports.** Only declared entry points. Enforced by
   `check:boundaries`.

## The state machine

The product's authorisation model is one table, in `services/engine/src/dignityindex_gate/analysis.py`:

```python
TRANSITIONS = {
    "draft":       ("evidenced", "blocked"),
    "evidenced":   ("contested", "adjudicated", "blocked"),
    "contested":   ("remediated", "blocked"),
    "remediated":  ("adjudicated", "contested", "blocked"),
    "adjudicated": ("released", "contested", "blocked"),
    "released":    ("blocked",),
    "blocked":     ("draft",),
}
```

Anything absent is refused with `TRANSITION_ILLEGAL`. Three guards sit on top of it —
`MISSING_EVIDENCE`, `INDEX_BELOW_FLOOR`, `BLOCKING_FINDINGS` — and each names the exact row or
fact that stopped it.

The web app renders the same table at `/policy`, from the engine's `matrix` op rather than from
a table written out again in TypeScript.

## The dignity index

Six harm classes, each scored 0–100 from a declaration's facts, combined by fixed integer weights
that sum to 100:

| Harm class         | Weight | Driven by                                             |
| ------------------ | ------ | ----------------------------------------------------- |
| `autonomy`         | 25     | automated, humanInLoop, appealable                    |
| `contestability`   | 20     | appealable, appealSlaHours                            |
| `proportionality`  | 15     | populationSize, monitors                              |
| `transparency`     | 15     | mandatory harm classes carrying an evidence reference |
| `data_sovereignty` | 15     | trainsOnPeople, specialCategories, proxies            |
| `reversibility`    | 10     | reversible                                            |

`index = sum(score_i * weight_i) // 100`. Floors: adjudicate at 50, release at 60. Integer
arithmetic throughout, so the same declaration gives the same number forever.

## The footprint ladder

1. Extend an existing tool
2. Add a CLI command plus a skill
3. Add a service-gated tool
4. Add a plugin
5. Add an MCP server tool
6. Add a new core tool — last resort

Every core tool is paid for in context window on every request, forever. Plugins are free.

## The deterministic engine

The parts that must be exactly right are code, not generation. They live in `services/engine`: a
dependency-free Python package called as a **pure function** over stdin/stdout. No server, no
port, no daemon, no shared state.

| op            | purpose                                                                   |
| ------------- | ------------------------------------------------------------------------- |
| `score`       | declaration → index, band, six components, blocking and advisory findings |
| `transitions` | declaration + state → every legal and every refused edge                  |
| `advance`     | attempt one transition → receipt or refusal with a stable code            |
| `board`       | many cases → rows grouped by state, with totals                           |
| `matrix`      | the transition table itself, legal and illegal edges                      |

See [adr/0002-python-engine-boundary.md](adr/0002-python-engine-boundary.md) and
[adr/0005-refusal-is-a-result.md](adr/0005-refusal-is-a-result.md).

## How the web app gets real data

`apps/web` depends on **no** workspace package (ADR 0003), so it cannot spawn the engine and must
not recompute the index — that would be a second implementation of the credibility core.

So it consumes the engine's own output, committed at `apps/web/lib/generated/board.json`:

```bash
npm run generate:web-data        # runs the engine over corpus/declarations.json
npm run check:generated-web-data # regenerates in memory and byte-compares
```

The generator also asserts that **every case's recorded state is one the gate would accept**. A
case marked `released` whose index is below the release floor fails the build. Without that
check the board could display a state the engine itself would have refused — the exact
inconsistency this product exists to make impossible.

## Storage

SQLite, WAL, numbered migrations. Verdicts are derived and recomputable; the adjudication
ledger is not, which is why its table carries `BEFORE UPDATE` and `BEFORE DELETE` triggers that
abort. See [adr/0004-storage-and-visual-deviations.md](adr/0004-storage-and-visual-deviations.md).

## Packages

| Package         | Responsibility                                                               |
| --------------- | ---------------------------------------------------------------------------- |
| `core`          | the `Tool` interface, the registry, permissions, the error taxonomy. No I/O. |
| `config`        | layered config; the zod schema is the source of truth                        |
| `memory`        | SQLite storage, numbered migrations, FTS5, the append-only ledger            |
| `skills`        | `SKILL.md` discovery, frontmatter parsing, catalog validation                |
| `plugins`       | manifest loading, schema validation, priority conflict resolution            |
| `channels`      | one `Channel` interface; retry and queueing live in the base class           |
| `providers`     | one `Provider` interface; a deterministic offline provider ships             |
| `mcp`           | MCP server (stdio) and MCP client, both over the core registry               |
| `engine-client` | typed subprocess bridge to the Python engine                                 |
| `cli`           | commander CLI; `doctor` is the flagship command                              |
| `sdk`           | the public facade — the stable surface and nothing else                      |

## Deliberate omissions

- **`apps/desktop`** — the board is a review surface three people share. A local shell adds a
  binary to ship and no capability the web board or CLI does not already provide.
- **Model providers on the verdict path** — a provider here would only launder a verdict past
  the deterministic engine. The additive work a model _should_ do (drafting the memo, explaining
  a refusal) would ship behind the same waist, never inside it.
