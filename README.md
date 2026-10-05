<div align="center">

# Dignity Index Gate

**Turn a declared AI deployment into a release verdict, and name the exact transition that blocked it.**

[CI](https://github.com/aniruddhaadak80/dignityindex-gate/actions/workflows/ci.yml) ·
[License](https://github.com/aniruddhaadak80/dignityindex-gate/blob/main/LICENSE) ·
[Issues](https://github.com/aniruddhaadak80/dignityindex-gate/issues)

</div>

---

## The problem

A hospital triages patients with a model. A lender scores applicants. An employer screens CVs.
Each is a decision about a person's life, and in every organisation the record of what was
actually checked before it shipped is a paragraph in a meeting note.

You can already ask a chatbot to review this. What you get back is fluent, confident, and
unreviewable: it cannot tell you that `draft → released` is not a legal move, because it does
not have a list of legal moves. It cannot tell you that its own answer six months from now will
differ from this one. And nobody can audit it, because it is prose.

## What this is

A **gate**. You declare what the system does, in facts only, and it returns a verdict:

- a **dignity index**, 0–100, from six harm classes scored by integer arithmetic
- the **legal next states**, and every state it refuses
- for each refusal, a **stable code** naming the row that forbade it
- a **receipt** whose id is a pure function of the arguments, so replaying an adjudication
  reproduces it exactly

The refusal is the product. A chatbot that will not say no is not a review board.

```
draft ──▶ evidenced ──▶ contested ──▶ remediated ──▶ adjudicated ──▶ released
  │           │                                         ▲               │
  └───────────┴─────────────────────────────────────────┴──▶ blocked ◀──┘
```

`blocked → draft` reopens. Everything not drawn is refused with `TRANSITION_ILLEGAL`, and the
web board lists the refusals under the rail, struck through, in coral.

## Quick start

```bash
git clone https://github.com/aniruddhaadak80/dignityindex-gate.git
cd dignityindex-gate
npm install
node packages/cli/dist/bin.js doctor
```

Requires Node 22.12+ and Python 3.11+. `doctor` probes the runtime, the skill catalog, the
plugin registry, the corpus, **the Python engine over a real subprocess**, and the SQLite
schema, and prints a fix hint for anything that fails.

```
dignityindex-gate doctor
  [PASS] node     v22.23.2
  [PASS] package  dignityindex-gate@0.1.0
  [PASS] skills   4 skills, 0 invalid
  [PASS] plugins  2 active, 0 disabled
  [PASS] corpus   9 review cases in corpus/declarations.json
  [PASS] engine   7 states in the transition table
  [PASS] memory   SQLite schema v3, no pending migrations
  [WARN] config   no product.config.json — using defaults
```

## Walkthrough

Every command below was run against this tree.

### 1. See what the build can do

```bash
node packages/cli/dist/bin.js tools
```

Eight tools, each with a description written for a model and an input schema it can fill.

### 2. Read the board

```bash
node packages/cli/dist/bin.js board
```

```
review board  (mean index 60)

  draft (1)
    CASE-0002  index  14  insufficient  3 blocking
  evidenced (1)
    CASE-0001  index  72  clear
  ...
  released (2)
    CASE-0007  index  83  clear
    CASE-0009  index  75  clear
  blocked (1)
    CASE-0004  index   9  insufficient  4 blocking

  9 cases, 2 released, 1 blocked, 2 with blocking findings
```

### 3. Run the engine directly

The engine is a pure Python function over stdin/stdout — no server, no port, no daemon:

```bash
echo '{"op":"matrix","input":null}' | python -m dignityindex_gate
```

Run it from `services/engine/src`. Same input, same output, every time: no clock, no network,
no randomness.

### 4. Ask what is permitted, and what is not

```bash
node packages/cli/dist/bin.js run gate_transitions '{"declaration":{"caseId":"CASE-0002","system":"resume-screen","domain":"hiring","decision":{"automated":true,"humanInLoop":false,"appealable":false,"appealSlaHours":0},"data":{"trainsOnPeople":true,"proxies":["name","postcode"],"specialCategories":[]},"impact":{"populationSize":180000,"reversible":false,"monitors":false},"evidence":[]},"state":"draft"}'
```

The `refused` array names every state the gate will not move to, and why. An empty `evidence`
array is why `evidenced` is refused.

### 5. Attempt the illegal move anyway

```bash
node packages/cli/dist/bin.js run gate_advance '{"declaration":{"caseId":"CASE-0001","system":"triage-priority","domain":"healthcare","decision":{"automated":true,"humanInLoop":true,"appealable":true,"appealSlaHours":72},"data":{"trainsOnPeople":true,"proxies":["postcode"],"specialCategories":["health"]},"impact":{"populationSize":2400000,"reversible":true,"monitors":false},"evidence":[{"harmClass":"autonomy","ref":"doc://policy/clinician-signoff-v3"},{"harmClass":"data_sovereignty","ref":"doc://dpi/2025-014"},{"harmClass":"reversibility","ref":"doc://policy/queue-reversal-runbook"}]},"from":"draft","to":"released","actor":"chair@board"}'
```

`ok: false` and `TRANSITION_ILLEGAL`. That is the answer, and it is a _result_ rather than an
exception — a refused transition is a legitimate reply, whereas malformed input is an error.

### 6. Regenerate the web board

```bash
npm run generate:web-data
npm run check:generated-web-data
```

The web app renders the engine's own output, committed as JSON. The second command regenerates
in memory and byte-compares, so the page can never show a number the engine did not produce.

### 7. Run the web workspace

```bash
npm run build --workspace @dignityindexgate/web
node apps/web/node_modules/.bin/next start apps/web --port 3000
```

```bash
curl -s localhost:3000/api/health
```

### 8. Connect an agent over MCP

This is not only an MCP client. It runs a server, which makes it a tool provider for other
agents:

```json
{
  "mcpServers": {
    "dignityindex-gate": {
      "command": "dignityindex-gate",
      "args": ["mcp", "serve"]
    }
  }
}
```

Prove it end to end — a real client, a real stdio transport, a real `tools/call` into the engine:

```bash
npm run prove:mcp
```

```
initialize ->
  serverInfo: {"name":"dignityindex-gate","version":"0.1.0"}
  protocolVersion: 2025-06-18

tools/list -> 8 tools
  gate_advance      Attempt one state transition and return either the receipt that would be…
  gate_board        Return every case in the review corpus grouped by state, with each digni…
  ...

tools/call gate_score ->
  CASE-0001 index=72 band=clear releasable=true
  components: autonomy=70 contestability=100 proportionality=40 transparency=100 data_sovereignty=25 reversibility=100
  blocking: 0  advisory: 1

tools/call gate_advance draft->released ->
  ok=false code=TRANSITION_ILLEGAL
  the transition table has no edge draft -> released; legal targets are evidenced, blocked

tools/call gate_score {} ->
  isError=true VALIDATION_FAILED: "declaration" is required
```

The last three blocks are the distinction that matters: a **refused transition is a result**,
while **malformed input is an error envelope**. See
[ADR 0005](docs/adr/0005-refusal-is-a-result.md).

### 9. Run the whole gate

```bash
npm run check
```

The exact command CI runs, in the same order: format, lint, typecheck, seven policy gates, the
TypeScript tests, the Python tests, the build.

## How it works

```
                 ┌───────────────┐
   CLI ─────────▶│               │
   Web ─────────▶│  ToolRegistry │──▶ packages/memory  (SQLite, WAL, append-only ledger)
   MCP server ──▶│               │
   Channel ─────▶└───────────────┘
                        │
                        └──▶ services/engine  (pure Python, stdin/stdout)
```

Five invariants:

1. Tools are **stateless**. State lives in `packages/memory`.
2. Input is validated **before** the handler runs, never after.
3. Permissions are **declared**, and a call exceeding the granted set is refused.
4. A duplicate tool name **throws**, naming both registrants.
5. No cross-package deep imports. `check:boundaries` enforces it.

### Why the engine is Python and not a model call

A plausible-but-wrong ethics verdict is unreviewable. A state machine is not: the transitions
are a table you can print (`/policy` in the web app), the index is integer arithmetic you can
disagree with component by component, and the whole thing re-derives from the same declaration
forever. See [ADR 0002](docs/adr/0002-python-engine-boundary.md).

### The footprint ladder

1. Extend an existing tool
2. Add a CLI command plus a skill
3. Add a service-gated tool
4. Add a plugin
5. Add an MCP server tool
6. Add a new core tool — **last resort**

Every core tool is paid for in context window on every request, forever. Plugins are free.

## What ships

| Surface                                                               | Status      |
| --------------------------------------------------------------------- | ----------- |
| CLI, MCP server and client, skills, plugins, memory, engine, channels | shipped     |
| Desktop shell                                                         | **omitted** |
| Model providers                                                       | **omitted** |

The web app renders [`apps/web/lib/product.ts`](apps/web/lib/product.ts), which is the
authoritative surface list including a stated reason for each omission. An omitted surface with
a reason is a design decision; one without is a gap.

## Documentation

| Page                                       | Read it when                               |
| ------------------------------------------ | ------------------------------------------ |
| [getting-started](docs/getting-started.md) | you have just cloned this                  |
| [architecture](docs/architecture.md)       | you need the map before changing anything  |
| [cli](docs/cli.md)                         | you are scripting the CLI                  |
| [mcp](docs/mcp.md)                         | you are connecting an agent                |
| [ci](docs/ci.md)                           | you are adding a gate                      |
| [adr/](docs/adr/)                          | you want the reasoning behind a decision   |
| [TENETS](TENETS.md)                        | you want the short list of non-negotiables |

## Development

```bash
npm run build        # turbo build across every package
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # vitest, every package
npm run pytest       # the Python engine, including property tests
npm run check        # everything CI runs
```

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). The rules that are not negotiable are in
[AGENTS.md](AGENTS.md).

## License

MIT — see [LICENSE](LICENSE). Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
