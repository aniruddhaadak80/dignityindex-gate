# CI and quality gates

## Job names

Branch protection keys on exact names. Renaming one silently disables the protection.

| Job                 | Runs                                             |
| ------------------- | ------------------------------------------------ |
| `Format`            | `prettier --check .`                             |
| `Lint`              | `eslint .`                                       |
| `Typecheck`         | `tsc --noEmit` across every package              |
| `Policy gates`      | the six `check:*` scripts                        |
| `Test`              | `vitest` across every package, Node 22 and 24    |
| `Python test`       | `pytest` + `mypy` + `ruff`, Python 3.11 and 3.12 |
| `Build`             | turbo build + the Next.js production build       |
| `Doctor smoke test` | `dignityindex-gate doctor` must exit 0           |
| `Secret scan`       | gitleaks over full history                       |
| `CodeQL`            | javascript-typescript and python, weekly         |

## The aggregate gate

`npm run check` is the exact command CI runs, in the same order. That is deliberate: local
and CI cannot drift, so a green local run means a green CI run.

Policy gates run **before** the expensive ones. A stray hex literal should fail in 200ms, not
after a three-minute build.

## The policy gates

| Gate                       | Fails when                                                       |
| -------------------------- | ---------------------------------------------------------------- |
| `check:skill-version`      | a `SKILL.md` body changed without a `metadata.version` bump      |
| `check:no-secrets`         | a credential is committed, or a `.env` has values                |
| `check:theme-tokens`       | a raw colour literal appears outside `styles/tokens.css`         |
| `check:boundaries`         | a package imports another package's undeclared deep path         |
| `check:public-hygiene`     | junk files, committed caches, oversized binaries, leftover TODOs |
| `check:readme-commands`    | the README names a command that does not exist                   |
| `check:generated-web-data` | the committed board data is not what the engine produces         |

Each failure prints the file, the line, and the fix. A gate that only says "failed" wastes the
person running it.

`check:generated-web-data` needs Python, so in CI it runs inside the `Policy gates` job with
`actions/setup-python` — which means the policy job is not Node-only. It regenerates the board in
memory and byte-compares rather than diffing git, so it works on a fresh checkout with no
commits, on a detached HEAD, and in CI.

The generator also refuses to write a corpus whose recorded states the engine would not accept: a
case marked `released` with an index below the release floor fails the build. That is the
product's central promise enforced mechanically rather than asserted in prose.

## Python gates

`pytest`, `mypy --strict` and `ruff` all run over `services/engine`, on Python 3.11 and 3.12.
`mypy --strict` over a dependency-free package is a genuinely strong gate — there is nowhere for
an untyped escape to hide.

## Prove the MCP surface

```bash
npm run prove:mcp
```

Spawns `bin.js mcp serve` as a subprocess, then performs `initialize`, `tools/list`, a
`tools/call` into the Python engine, a refused transition, and a malformed call. It asserts the
MCP tool list matches the core registry, so a tool that is registered but not exposed fails
loudly rather than quietly disappearing.

## Supply chain

Every third-party action is pinned to a **commit SHA** with the version in a trailing comment.
A mutable tag means anyone who compromises the tag owns your CI.

## Adding a gate

1. Add `scripts/check-<name>.mjs`.
2. Wire it into `package.json` scripts.
3. Add it to `check` **before** the expensive steps.
4. Add a row to the table above.
5. Make sure it fails on a deliberately broken input — a gate that has never failed is not
   known to work.

## Local parity

```bash
npm run check     # identical to CI
```
