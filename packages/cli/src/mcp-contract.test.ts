import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { McpClient } from '@dignityindexgate/mcp'
import { buildToolRegistry, createContext, loadCorpus, resolveProductRoot } from './bootstrap.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BIN = join(REPO_ROOT, 'packages', 'cli', 'dist', 'bin.js')

/**
 * The real MCP surface, proven with a real client over a real stdio transport.
 *
 * This is deliberately an end-to-end test rather than an in-process server call: the failure
 * mode this catches is a transport or handshake regression, which an in-process test cannot
 * observe at all. turbo's `test` task now depends on `build`, so dist/bin.js exists.
 */
describe('MCP over stdio', () => {
  const client = new McpClient()
  let connected = false

  beforeAll(async () => {
    expect(
      existsSync(BIN),
      `${BIN} must exist — turbo test depends on build, so this indicates a broken task graph`,
    ).toBe(true)
    await client.connect({
      id: 'self',
      command: process.execPath,
      args: [BIN, 'mcp', 'serve'],
      enabled: true,
    })
    connected = true
  }, 60_000)

  afterAll(async () => {
    if (connected) await client.close()
  })

  it('lists every product tool over the protocol', async () => {
    const tools = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'gate_advance',
      'gate_board',
      'gate_matrix',
      'gate_score',
      'gate_transitions',
      'list_plugins',
      'list_skills',
      'load_declaration',
    ])
  })

  it('describes every tool for a model', async () => {
    for (const tool of await client.listTools()) {
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.inputSchema).toHaveProperty('type', 'object')
    }
  })

  it('answers a tools/call that reaches the Python engine', async () => {
    const result = (await client.callTool('gate_matrix', {})) as {
      states: string[]
      floors: Record<string, number>
    }
    expect(result.states).toHaveLength(7)
    expect(result.floors).toEqual({ adjudication: 50, release: 60 })
  })

  it('carries real corpus data across the protocol', async () => {
    const entry = loadCorpus(REPO_ROOT)[0]!
    const declaration = (await client.callTool('load_declaration', {
      caseId: entry.declaration.caseId,
    })) as { declaration: { caseId: string } }

    const verdict = (await client.callTool('gate_score', {
      declaration: declaration.declaration,
    })) as { index: number; components: unknown[] }

    expect(verdict.components).toHaveLength(6)
    expect(verdict.index).toBeGreaterThanOrEqual(0)
  })

  it('returns a policy refusal as a structured result, not a transport error', async () => {
    // A refusal is a legitimate ANSWER ("no, and here is the row that forbids it"), so it
    // comes back as ok:false with a stable code rather than as an exception. Throwing would
    // turn a normal policy outcome into a failure an agent has to unwrap.
    const entry = loadCorpus(REPO_ROOT)[0]!
    const result = (await client.callTool('gate_advance', {
      declaration: entry.declaration,
      from: 'draft',
      to: 'released',
      actor: 'chair@board',
    })) as { ok: boolean; receipt: unknown; error: { code: string; message: string } }

    expect(result.ok).toBe(false)
    expect(result.receipt).toBeNull()
    expect(result.error.code).toBe('TRANSITION_ILLEGAL')
    expect(result.error.message).toContain('legal targets are')
  })

  it('returns an MCP error envelope for a genuinely malformed call', async () => {
    // The distinction the previous test pins down: bad input is an error, a refused
    // transition is a result.
    await expect(client.callTool('gate_score', {})).rejects.toThrowError(/VALIDATION_FAILED/)
  })

  it('is stateless — the same call twice returns the same receipt', async () => {
    const entry = loadCorpus(REPO_ROOT).find((item) => item.state === 'released')!
    const args = {
      declaration: entry.declaration,
      from: 'adjudicated',
      to: 'released',
      actor: 'chair@board',
    }
    const first = (await client.callTool('gate_advance', args)) as { receipt: { receiptId: string } }
    const second = (await client.callTool('gate_advance', args)) as { receipt: { receiptId: string } }
    expect(first.receipt.receiptId).toBe(second.receipt.receiptId)
  })

  it('rejects a call for a tool that does not exist', async () => {
    await expect(client.callTool('no_such_tool', {})).rejects.toThrow()
  })
})

describe('product root resolution', () => {
  it('finds the repo root from the module, not the working directory', () => {
    // The regression: resolving the engine from process.cwd() made `mcp serve` fail with
    // `spawn python ENOENT` whenever it was launched from anywhere but the repo root, because
    // the engine's cwd did not exist. That is the whole reason this test exists.
    expect(resolveProductRoot()).toBe(resolve(REPO_ROOT))
    expect(existsSync(join(resolveProductRoot(), 'corpus', 'declarations.json'))).toBe(true)
    expect(existsSync(join(resolveProductRoot(), 'services', 'engine', 'src'))).toBe(true)
  })

  it('loads the corpus without being told where it is', () => {
    expect(loadCorpus().length).toBeGreaterThan(0)
  })

  it('reaches the engine with the resolved root, from an unrelated cwd', async () => {
    const previous = process.cwd()
    process.chdir(tmpdir())
    try {
      const registry = buildToolRegistry()
      const result = (await registry.invoke('gate_matrix', {}, createContext('cwd-test'), [
        'proc:spawn',
      ])) as { states: string[] }
      expect(result.states).toContain('draft')
    } finally {
      process.chdir(previous)
    }
  }, 60_000)
})
