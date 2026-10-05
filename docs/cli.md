# CLI reference

```bash
dignityindex-gate <command> [options]
```

In this repository the binary has not been linked, so the commands are run as
`node packages/cli/dist/bin.js <command>`.

## Exit codes

| Code | Meaning                                                               |
| ---- | --------------------------------------------------------------------- |
| `0`  | success — **including a refused transition**, which is a valid answer |
| `1`  | runtime failure: a check failed, or a tool returned an error          |
| `2`  | usage error: unknown command or malformed JSON argument               |

## Commands

| Command                  | Purpose                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `doctor`                 | probe every subsystem: node, package, skills, plugins, corpus, engine, memory, config |
| `tools`                  | list registered tools — the authoritative capability list                             |
| `skills`                 | list the skill catalog with every validation issue                                    |
| `plugins`                | show the resolved plugin registry, including shadowed and rejected                    |
| `cases`                  | list the corpus declarations available to score                                       |
| `board`                  | render the review board: state, index, band, blocking counts                          |
| `run <tool> <json>`      | invoke one tool directly, without MCP                                                 |
| `mcp serve`              | run the MCP server over stdio                                                         |
| `mcp call <tool> <json>` | same as `run`; kept for symmetry with `mcp`                                           |
| `version`                | version, runtime and capability counts as JSON                                        |
| `help`                   | usage                                                                                 |

## The tools

| Tool               | Permissions             | Purpose                                    |
| ------------------ | ----------------------- | ------------------------------------------ |
| `gate_score`       | `proc:spawn`            | dignity index, band, components, findings  |
| `gate_transitions` | `proc:spawn`            | legal and refused edges out of a state     |
| `gate_advance`     | `proc:spawn`            | attempt one transition; receipt or refusal |
| `gate_board`       | `proc:spawn`, `fs:read` | every case grouped by state                |
| `gate_matrix`      | `proc:spawn`            | the transition table and the floors        |
| `load_declaration` | `fs:read`               | fetch a corpus declaration by `caseId`     |
| `list_skills`      | `fs:read`               | the skill catalog                          |
| `list_plugins`     | `fs:read`               | the resolved plugin registry               |

## Machine-readable output

Every read-only command accepts `--json`, which writes a single JSON document to stdout and
nothing else. Diagnostics always go to stderr, so `--json` output is always safe to pipe.

```bash
dignityindex-gate board --json | jq '.totals'
```

## Running the engine directly

The engine is a pure function over stdin/stdout, from `services/engine/src`:

```bash
echo '{"op":"matrix","input":null}' | python -m dignityindex_gate
```

```bash
echo '{"op":"score","input":{"caseId":"C1","system":"s","domain":"credit","decision":{"automated":true,"humanInLoop":true,"appealable":true,"appealSlaHours":168},"data":{"trainsOnPeople":false,"proxies":[],"specialCategories":[]},"impact":{"populationSize":50000,"reversible":true,"monitors":false},"evidence":[{"harmClass":"autonomy","ref":"doc://a"},{"harmClass":"contestability","ref":"doc://b"},{"harmClass":"proportionality","ref":"doc://c"},{"harmClass":"data_sovereignty","ref":"doc://d"}]}}' | python -m dignityindex_gate
```

## The `doctor` contract

`doctor` never throws. Every failing row carries a **fix hint**, and the probe layer itself is
wrapped so an exploding probe becomes a row rather than a crash. The exit code is `1` if any
required check failed, `0` otherwise — which is what lets it run in CI as a smoke test without
taking the build down on a missing optional credential.

The `engine` row is a real probe: it spawns Python and round-trips a `matrix` call. It does not
report a version string from a constant.

## Exit codes on a refusal

```bash
dignityindex-gate run gate_advance '{"declaration": …, "from":"draft", "to":"released", "actor":"chair"}'
```

exits `0` and prints `{"ok": false, "error": {"code": "TRANSITION_ILLEGAL", …}}`. A refused
transition is an answer. Malformed input exits `2` or throws an error envelope instead. See
[adr/0005-refusal-is-a-result.md](adr/0005-refusal-is-a-result.md).
