#!/usr/bin/env node
// Fails when apps/web/lib/generated/board.json no longer matches what the engine produces.
//
// This is the genoffice committed-fixture drift gate. It regenerates in memory and
// byte-compares rather than diffing git, so it works on a fresh checkout with no commits,
// on a detached HEAD, and inside CI. A gate that depends on git state is a gate that can
// silently stop gating.

import { existsSync, readFileSync } from 'node:fs'
import { buildWebData, GENERATED, serialize } from './lib/web-data.mjs'

if (!existsSync(GENERATED)) {
  console.error('check:generated-web-data FAILED — apps/web/lib/generated/board.json is missing')
  console.error('  fix: run `npm run generate:web-data`')
  process.exit(1)
}

const expected = serialize(buildWebData())
const actual = readFileSync(GENERATED, 'utf8')

if (expected !== actual) {
  const expectedLines = expected.split('\n')
  const actualLines = actual.split('\n')
  const firstDiff = expectedLines.findIndex((line, index) => line !== actualLines[index])

  console.error('check:generated-web-data FAILED — the committed board data is stale')
  if (firstDiff !== -1) {
    console.error(`  first difference at line ${firstDiff + 1}:`)
    console.error(`    engine:   ${expectedLines[firstDiff] ?? '(end of file)'}`)
    console.error(`    committed: ${actualLines[firstDiff] ?? '(end of file)'}`)
  }
  console.error('  fix: run `npm run generate:web-data` and commit the result')
  process.exit(1)
}

console.log('check:generated-web-data — clean (board data matches the engine byte for byte)')
