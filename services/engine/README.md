# dignityindex_gate

The deterministic engine for [dignityindex-gate](../README.md).

## Why Python

The parts of this product that must be exactly right are code, not generation: the transition
table, the guards, and six harm-class scores combined by integer arithmetic. Keeping them in a
separate, dependency-free package means they can be property-tested in isolation and called as a
pure function — no server, no port, no daemon, no shared state.

## Protocol

One JSON object on stdin, one on stdout. From this directory:

```console
$ echo '{"op":"matrix","input":null}' | python -m dignityindex_gate
{"ok":true,"value":{"states":["draft","evidenced","contested","remediated","adjudicated","released","blocked"],...
```

Errors never raise a traceback. They come back as
`{"ok": false, "error": {"code": "...", "message": "..."}}` so the host can map a stable code to
an exit code or an HTTP status.

## Operations

| op            | input                                | output                                                      |
| ------------- | ------------------------------------ | ----------------------------------------------------------- |
| `score`       | `declaration`                        | index, band, six components, blocking and advisory findings |
| `transitions` | `declaration`, `state`               | `legal`, and `refused` with a code per edge                 |
| `advance`     | `declaration`, `from`, `to`, `actor` | `{ok, receipt \| null, error \| null}`                      |
| `board`       | `cases`                              | rows grouped by state, totals, mean index                   |
| `matrix`      | `null`                               | the transition table, the floors, the weights               |

## The transition table

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

Anything absent is refused with `TRANSITION_ILLEGAL`. Guards add `MISSING_EVIDENCE`,
`INDEX_BELOW_FLOOR` and `BLOCKING_FINDINGS`.

## Rules for anything added here

1. Pure. No clock, no network, no randomness, no filesystem.
2. Time and entropy are arguments, never reads.
3. Typed input and output via `TypedDict`.
4. A `TypedDict` cannot declare a field named `from` or `to` — those are keywords. The receipt and
   the edge types use `source`/`target` and `target` for that reason.
5. One named operation per entry point, registered in `OPERATIONS`.
6. `mypy --strict` clean.

## Development

```bash
python -m pytest services/engine -q        # tests, including property tests
python -m mypy services/engine/src        # type gate
python -m ruff check services/engine      # lint gate
```

Copyright 2026 aniruddhaadak80. Licensed under the Apache License 2.0.
