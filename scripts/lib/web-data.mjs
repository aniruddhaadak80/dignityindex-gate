// Builds apps/web/lib/generated/board.json by calling the deterministic Python engine.
//
// Why this exists rather than the web app computing the index itself: ADR 0003 keeps
// apps/web free of workspace dependencies so the Vercel build cannot break on a turbo
// cache miss. The cost is that the web app cannot import packages/memory or spawn the
// engine. Recomputing the index in TypeScript would create a SECOND implementation of the
// credibility core, which the narrow waist forbids outright.
//
// So the web app consumes the engine's own output, committed as JSON. Every number it
// renders was produced by `python -m dignityindex_gate`. scripts/check-generated-web-data.mjs
// regenerates and byte-compares, so the committed file cannot silently drift from the
// engine.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(HERE, '..', '..')

const CORPUS = join(ROOT, 'corpus', 'declarations.json')
const ENGINE_SRC = join(ROOT, 'services', 'engine', 'src')
export const GENERATED = join(ROOT, 'apps', 'web', 'lib', 'generated', 'board.json')

const PYTHON = process.env.PYTHON ?? 'python'
const MODULE = 'dignityindex_gate'

/**
 * One engine call. The engine is a pure function over stdin/stdout, so this spawns a fresh
 * process per op and cannot interleave state with a concurrent call.
 */
export function runEngine(op, input) {
  const request = JSON.stringify({ op, input })
  const stdout = execFileSync(PYTHON, ['-m', MODULE], {
    cwd: ENGINE_SRC,
    input: request,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const response = JSON.parse(stdout.trim())
  if (!response.ok) {
    const { code, message } = response.error ?? {}
    throw new Error(`engine op "${op}" failed: ${code ?? 'UNKNOWN'}: ${message ?? 'no message'}`)
  }
  return response.value
}

export function readCorpus() {
  return JSON.parse(readFileSync(CORPUS, 'utf8'))
}

/**
 * Every case's recorded state must be one the gate itself would accept.
 *
 * Without this, the board can display a case sitting in `released` whose own index is below
 * the release floor — which is precisely the inconsistency this product exists to make
 * impossible. A demo dataset that contradicts its own engine destroys the argument faster
 * than any amount of documentation.
 */
function assertStateAgreesWithVerdict(entry, verdict) {
  const where = `${entry.declaration.caseId} (${entry.state})`
  const blocking = verdict.blocking.map((finding) => finding.code).join(', ')

  if (entry.state === 'released' && !verdict.releasable) {
    throw new Error(
      `corpus case ${where} is marked released but the engine would refuse it: ` +
        `index ${verdict.index}, blocking: ${blocking || 'none'}`,
    )
  }
  if (entry.state === 'adjudicated' && verdict.blocking.length > 0) {
    throw new Error(`corpus case ${where} is adjudicated but still has blocking findings: ${blocking}`)
  }
  if (entry.state === 'evidenced') {
    const missing = verdict.mandatory.filter((name) => !verdict.evidenced.includes(name))
    if (missing.length > 0) {
      throw new Error(
        `corpus case ${where} is marked evidenced but these harm classes have no reference: ` +
          missing.join(', '),
      )
    }
  }
}

/** Every op the web app renders comes from here, and nothing else. */
export function buildWebData() {
  const corpus = readCorpus()
  const cases = corpus.cases.map((entry) => ({
    caseId: entry.declaration.caseId,
    state: entry.state,
    system: entry.declaration.system,
    domain: entry.declaration.domain,
    verdict: runEngine('score', entry.declaration),
    transitions: runEngine('transitions', { declaration: entry.declaration, state: entry.state }),
  }))

  for (const entry of corpus.cases) {
    assertStateAgreesWithVerdict(entry, runEngine('score', entry.declaration))
  }

  return {
    generatedBy: 'services/engine (dignityindex_gate)',
    note: 'Generated file. Run `npm run generate:web-data` after editing corpus/declarations.json.',
    matrix: runEngine('matrix', null),
    board: runEngine('board', { cases: corpus.cases }),
    cases,
  }
}

/** Stable serialisation: sorted keys, trailing newline, LF. Byte-comparison depends on it. */
export function serialize(data) {
  return `${JSON.stringify(data, null, 2)}\n`
}
