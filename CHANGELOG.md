# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The product: a review gate for AI systems that decide things about people. A declaration of
  facts in, a release verdict and a receipt out.
- The deterministic engine: an explicit transition table plus a six-component dignity index,
  scored by integer arithmetic in pure Python over stdin/stdout. Ops `score`, `transitions`,
  `advance`, `board`, `matrix`.
- Four stable refusal codes — `TRANSITION_ILLEGAL`, `MISSING_EVIDENCE`, `INDEX_BELOW_FLOOR`,
  `BLOCKING_FINDINGS` — each naming the row or fact that stopped the transition.
- Eight tools on the narrow waist: the five gate ops, `load_declaration`, `list_skills`,
  `list_plugins`.
- CLI commands `cases`, `board`, `skills`, `plugins`, `run`, plus `doctor`, `tools`, `version`
  and `mcp serve|call`. `doctor` now probes the corpus, the Python engine over a real
  subprocess, and the SQLite schema.
- A review corpus of nine cases spanning every board state, with a generator that refuses to
  write a corpus whose recorded states the engine would not accept.
- An append-only adjudication ledger in `packages/memory`, enforced by `BEFORE UPDATE` and
  `BEFORE DELETE` triggers rather than by convention.
- The web review board: three-column master/detail/inspector, the transition rail as the
  signature element, count-up motion on every index, three distinct loading/empty/error states.
- `npm run generate:web-data` and `npm run check:generated-web-data`, so the deployed board
  provably renders engine output and cannot drift from it.
- `docs/adr/0005-refusal-is-a-result.md`.

### Changed

- `turbo.json`: `test` now depends on `build`, not `^build`, so a package's own `dist` exists
  when its tests run. Required by the MCP stdio contract test.
- `doctor`'s probes are injectable and the never-throws guarantee is enforced at the call site,
  so an exploding probe becomes a failing row rather than a crash.
- `.prettierignore` excludes `apps/web/lib/generated`; the generator's output is canonical and
  reformatting it would make the drift gate permanently red.

### Omitted

- Desktop shell, and model providers on the verdict path. Both with stated reasons in
  `apps/web/lib/product.ts`.

## [0.1.0] - 2026-10-05

### Added

- The narrow waist: one `Tool` interface and one `ToolRegistry`, reachable from the CLI, the
  web app, the MCP server and every channel.
- The deterministic Python engine, called as a pure function over stdin/stdout.
- The skills catalog with frontmatter validation and a CI version gate.
- The plugin registry with schema validation and priority-based conflict resolution.
- SQLite storage with WAL, numbered migrations and FTS5 search.
- An MCP server exposing the registry over stdio, plus an MCP client.
- The web workspace, deployed to Vercel, with a real `/api/health` endpoint.

[Unreleased]: https://github.com/aniruddhaadak80/dignityindex-gate/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aniruddhaadak80/dignityindex-gate/releases/tag/v0.1.0
