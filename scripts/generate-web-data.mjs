#!/usr/bin/env node
// Regenerate the web app's data from the deterministic engine.
//
// The web app renders engine output, so this is the only way that file is ever written.
// Editing it by hand is a bug: check-generated-web-data.mjs will catch it.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { buildWebData, GENERATED, serialize } from './lib/web-data.mjs'

let data
try {
  data = buildWebData()
} catch (cause) {
  // A raw stack trace is not a diagnosis. Name the file, the case, and the remedy.
  console.error(`generate:web-data FAILED — ${cause.message}`)
  console.error('  fix: the corpus and the engine disagree; correct corpus/declarations.json')
  console.error('       so every recorded state is one the gate would actually accept.')
  process.exit(1)
}

mkdirSync(dirname(GENERATED), { recursive: true })
writeFileSync(GENERATED, serialize(data), 'utf8')

const counts = data.board.totals
console.log(`generate:web-data — wrote ${GENERATED.slice(GENERATED.indexOf('apps'))}`)
console.log(
  `  ${counts.cases} cases, mean index ${data.board.meanIndex}, ` +
    `${counts.released} released, ${counts.blocked} blocked, ` +
    `${counts.withBlockingFindings} with blocking findings`,
)
