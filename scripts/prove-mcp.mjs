#!/usr/bin/env node
// Proves the MCP surface with a real client over a real stdio transport.
//
// This is not a unit test. It launches `bin.js mcp serve` as a subprocess, speaks MCP to it,
// and prints what came back — including a tools/call that reaches the Python engine. It exists
// because "the MCP server works" is a claim, and this is the command that makes it evidence.
//
//   npm run prove:mcp

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildToolRegistry, resolveProductRoot } from '../packages/cli/dist/bootstrap.js'

const ROOT = resolveProductRoot(dirname(fileURLToPath(import.meta.url)))
const BIN = join(ROOT, 'packages', 'cli', 'dist', 'bin.js')

if (!existsSync(BIN)) {
  console.error(`prove:mcp FAILED — ${BIN} does not exist. Run \`npm run build\` first.`)
  process.exit(1)
}

const child = spawn(process.execPath, [BIN, 'mcp', 'serve'], {
  cwd: ROOT,
  stdio: ['pipe', 'pipe', 'inherit'],
})

let buffer = ''
const pending = new Map()
let nextId = 1

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8')
  let index = buffer.indexOf('\n')
  while (index !== -1) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line === '') {
      index = buffer.indexOf('\n')
      continue
    }
    let message
    try {
      message = JSON.parse(line)
    } catch {
      index = buffer.indexOf('\n')
      continue
    }
    const resolve = pending.get(message.id)
    if (resolve !== undefined) {
      pending.delete(message.id)
      resolve(message)
    }
    index = buffer.indexOf('\n')
  }
})

function request(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`timed out waiting for ${method}`))
    }, 60_000)
    pending.set(id, (message) => {
      clearTimeout(timer)
      resolve(message)
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
}

function fail(message) {
  console.error(`prove:mcp FAILED — ${message}`)
  child.kill()
  process.exit(1)
}

try {
  console.log(`spawning ${BIN} mcp serve\n`)

  notify('notifications/initialized', {})
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'prove-mcp', version: '1.0.0' },
  })
  console.log('initialize ->')
  console.log(`  serverInfo: ${JSON.stringify(init.result?.serverInfo)}`)
  console.log(`  protocolVersion: ${init.result?.protocolVersion}`)

  const listed = await request('tools/list', {})
  const tools = listed.result?.tools ?? []
  console.log(`\ntools/list -> ${tools.length} tools`)
  for (const tool of tools) {
    console.log(`  ${tool.name.padEnd(17)} ${String(tool.description).slice(0, 72)}…`)
  }

  // A tools/call that reaches the Python engine, not just the registry.
  const registry = buildToolRegistry(ROOT)
  const entry = JSON.parse(
    await import('node:fs').then((fs) => fs.readFileSync(join(ROOT, 'corpus', 'declarations.json'), 'utf8')),
  ).cases[0]

  const scored = await request('tools/call', {
    name: 'gate_score',
    arguments: { declaration: entry.declaration },
  })
  const verdict = JSON.parse(scored.result.content[0].text)
  console.log(`\ntools/call gate_score ->`)
  console.log(
    `  ${entry.declaration.caseId} index=${verdict.index} band=${verdict.band} releasable=${verdict.releasable}`,
  )
  console.log(`  components: ${verdict.components.map((c) => `${c.harmClass}=${c.score}`).join(' ')}`)
  console.log(`  blocking: ${verdict.blocking.length}  advisory: ${verdict.advisory.length}`)

  // A refusal over the wire: a result, not an exception. ADR 0005.
  const refused = await request('tools/call', {
    name: 'gate_advance',
    arguments: { declaration: entry.declaration, from: 'draft', to: 'released', actor: 'chair' },
  })
  const decision = JSON.parse(refused.result.content[0].text)
  console.log(`\ntools/call gate_advance draft->released ->`)
  console.log(`  ok=${decision.ok} code=${decision.error?.code}`)
  console.log(`  ${decision.error?.message}`)

  // A genuine fault must come back as an MCP error envelope.
  const faulted = await request('tools/call', { name: 'gate_score', arguments: {} })
  console.log(`\ntools/call gate_score {} ->`)
  console.log(
    `  isError=${faulted.result?.isError} ${String(faulted.result?.content?.[0]?.text).slice(0, 80)}`,
  )

  console.log(`\nregistry agrees: ${registry.size} tools, ${tools.length} exposed over MCP`)
  if (tools.length !== registry.size) {
    fail(`MCP exposed ${tools.length} tools but the registry holds ${registry.size}`)
  }

  console.log('\nprove:mcp — every step above is real protocol output from a real subprocess.')
} catch (cause) {
  fail(String(cause))
} finally {
  child.kill()
}
