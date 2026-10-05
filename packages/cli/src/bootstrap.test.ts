import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isProductError } from '@dignityindexgate/core'
import { buildToolRegistry, createContext, loadCorpus } from './bootstrap.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ctx = createContext('bootstrap-test')

function registry() {
  return buildToolRegistry(REPO_ROOT)
}

async function invoke(name: string, input: unknown, granted: string[] = ['fs:read', 'proc:spawn']) {
  return await registry().invoke(name, input, ctx, granted as never)
}

const firstCase = () => loadCorpus(REPO_ROOT)[0]!

describe('the product tool registry', () => {
  it('registers the gate capabilities plus the catalog tools', () => {
    expect(registry().names()).toEqual([
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

  it('exposes at least five tools, which is the product contract', () => {
    expect(registry().size).toBeGreaterThanOrEqual(5)
  })

  it('gives every tool an MCP-safe name', () => {
    for (const name of registry().names()) {
      expect(name).toMatch(/^[a-z][a-z0-9_]{0,63}$/)
    }
  })

  it('gives every tool a model-usable description and object input schema', () => {
    for (const tool of registry().list()) {
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.inputSchema).toHaveProperty('type', 'object')
    }
  })

  it('declares the permissions each tool actually needs', () => {
    const byName = new Map(
      registry()
        .list()
        .map((tool) => [tool.name, tool.permissions]),
    )
    expect(byName.get('gate_score')).toEqual(['proc:spawn'])
    expect(byName.get('list_skills')).toEqual(['fs:read'])
  })

  it('loads a declaration from the corpus', async () => {
    const result = (await invoke('load_declaration', { caseId: 'CASE-0003' })) as {
      declaration: { caseId: string; domain: string }
    }
    expect(result.declaration.caseId).toBe('CASE-0003')
    expect(result.declaration.domain).toBe('credit')
  })

  it('names the known cases when asked for one that does not exist', async () => {
    await expect(invoke('load_declaration', { caseId: 'CASE-9999' })).rejects.toThrowError(
      /known cases: CASE-0001/,
    )
  })

  it('scores a real declaration through the Python engine', async () => {
    const declaration = firstCase().declaration
    const verdict = (await invoke('gate_score', { declaration })) as {
      index: number
      band: string
      releasable: boolean
      components: { harmClass: string; score: number }[]
    }
    expect(verdict.index).toBeGreaterThanOrEqual(0)
    expect(verdict.components).toHaveLength(6)
    expect(['clear', 'contested-review', 'insufficient']).toContain(verdict.band)
  })

  it('returns the transition table', async () => {
    const matrix = (await invoke('gate_matrix', {})) as {
      states: string[]
      edges: { legal: boolean }[]
      floors: Record<string, number>
    }
    expect(matrix.states).toContain('draft')
    expect(matrix.edges.filter((edge) => edge.legal).length).toBeGreaterThan(0)
    expect(matrix.floors.release).toBe(60)
  })

  it('lists legal and refused transitions for a real state', async () => {
    const declaration = firstCase().declaration
    const result = (await invoke('gate_transitions', { declaration, state: 'draft' })) as {
      legal: string[]
      refused: { code: string }[]
    }
    const covered = new Set([...result.legal, ...result.refused.map((edge) => edge.target)])
    expect(covered.size).toBe(7)
    expect(result.refused.some((edge) => edge.code === 'TRANSITION_ILLEGAL')).toBe(true)
  })

  it('issues a receipt for a legal transition', async () => {
    const entry = loadCorpus(REPO_ROOT).find((item) => item.state === 'released')!
    const result = (await invoke('gate_advance', {
      declaration: entry.declaration,
      from: 'adjudicated',
      to: 'released',
      actor: 'chair@board',
    })) as { ok: boolean; receipt: { receiptId: string; index: number } | null }
    expect(result.ok).toBe(true)
    expect(result.receipt?.receiptId).toContain('adjudicated->released')
  })

  it('refuses an illegal transition with a stable code', async () => {
    const result = (await invoke('gate_advance', {
      declaration: firstCase().declaration,
      from: 'draft',
      to: 'released',
      actor: 'chair@board',
    })) as { ok: boolean; error: { code: string; message: string } | null }
    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('TRANSITION_ILLEGAL')
    expect(result.error?.message).toContain('legal targets are')
  })

  it('renders the whole review board', async () => {
    const board = (await invoke('gate_board', {})) as {
      totals: { cases: number }
      columns: Record<string, unknown[]>
    }
    expect(board.totals.cases).toBe(9)
    expect(Object.keys(board.columns)).toHaveLength(7)
  })

  it('lists the skill catalog', async () => {
    const result = (await invoke('list_skills', {})) as { count: number; issues: string[] }
    expect(result.count).toBeGreaterThan(0)
    expect(result.issues).toEqual([])
  })

  it('lists the plugin registry', async () => {
    const result = (await invoke('list_plugins', {})) as { active: { name: string }[] }
    expect(result.active.map((plugin) => plugin.name)).toContain('sample')
  })

  describe('input validation', () => {
    it('rejects a missing declaration', async () => {
      await expect(invoke('gate_score', {})).rejects.toThrowError(/"declaration" is required/)
    })

    it('rejects a non-object declaration', async () => {
      await expect(invoke('gate_score', { declaration: 'nope' })).rejects.toThrowError(/must be an object/)
    })

    it('rejects a missing state', async () => {
      await expect(invoke('gate_transitions', { declaration: firstCase().declaration })).rejects.toThrowError(
        /"state" must be a non-empty string/,
      )
    })

    it('rejects a missing actor on advance', async () => {
      await expect(
        invoke('gate_advance', {
          declaration: firstCase().declaration,
          from: 'draft',
          to: 'evidenced',
        }),
      ).rejects.toThrowError(/"actor" must be a non-empty string/)
    })

    it('surfaces an engine error as a product error, not a raw crash', async () => {
      try {
        await invoke('gate_score', {
          declaration: { caseId: 'X', system: 's', domain: 'astrology' },
        })
        expect.unreachable('the engine should have rejected this domain')
      } catch (cause) {
        expect(isProductError(cause)).toBe(true)
        if (isProductError(cause)) {
          expect(cause.code).toBe('UPSTREAM_FAILED')
          expect(cause.details.code).toBe('UNKNOWN_DOMAIN')
        }
      }
    })

    it('reports a missing required field before the domain check', async () => {
      try {
        await invoke('gate_score', { declaration: { caseId: 'X', domain: 'astrology' } })
        expect.unreachable('the engine should have rejected the missing system')
      } catch (cause) {
        expect(isProductError(cause)).toBe(true)
        if (isProductError(cause)) {
          expect(cause.details.code).toBe('BAD_SHAPE')
        }
      }
    })
  })

  it('refuses a tool whose permissions are not granted', async () => {
    await expect(
      invoke('gate_score', { declaration: firstCase().declaration }, ['fs:read']),
    ).rejects.toThrowError(/permissions not granted/)
  })
})
