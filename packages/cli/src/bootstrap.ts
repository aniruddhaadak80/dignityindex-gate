import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ToolRegistry, ValidationError, type Tool, type ToolContext } from '@dignityindexgate/core'
import { buildRegistry } from '@dignityindexgate/plugins'
import { loadCatalog } from '@dignityindexgate/skills'

export const ENGINE_MODULE = 'dignityindex_gate'

/** The corpus of hand-maintained review cases. INPUT to the engine, never output. */
export const CORPUS_PATH = 'corpus/declarations.json'

/**
 * Resolves the product root by walking up from this module, not from process.cwd().
 *
 * This exists because of a real bug: resolving the engine relative to the working directory
 * meant `dignityindex-gate mcp serve` started from a package subdirectory spawned python with
 * a non-existent `cwd`, which surfaced as `spawn python ENOENT` — indistinguishable from "python
 * is not installed" when python is sitting on disk. A tool that cannot find its own engine when
 * launched from anywhere but the repo root is broken, and the failure mode is actively
 * misleading.
 *
 * A directory is the product root when it holds both the corpus and the engine package.
 */
export function resolveProductRoot(startDir = dirname(fileURLToPath(import.meta.url))): string {
  const override = process.env.PRODUCT_ROOT
  if (override !== undefined && override !== '') return resolve(override)

  let dir = resolve(startDir)
  for (let depth = 0; depth < 12; depth += 1) {
    const hasCorpus = existsSync(join(dir, 'corpus', 'declarations.json'))
    const hasEngine = existsSync(join(dir, 'services', 'engine', 'src'))
    if (hasCorpus && hasEngine) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Fall back to the working directory so the error names the path the user actually chose.
  return process.cwd()
}

export interface CorpusCase {
  readonly state: string
  readonly declaration: {
    readonly caseId: string
    readonly system: string
    readonly domain: string
    [key: string]: unknown
  }
}

export function loadCorpus(cwd = resolveProductRoot()): readonly CorpusCase[] {
  const raw = readFileSync(join(cwd, CORPUS_PATH), 'utf8')
  const parsed = JSON.parse(raw) as { cases?: unknown }
  if (!Array.isArray(parsed.cases)) {
    throw new ValidationError(`${CORPUS_PATH} has no "cases" array`, { path: CORPUS_PATH })
  }
  return parsed.cases as CorpusCase[]
}

/**
 * Builds the one registry every surface shares.
 *
 * These tools are real and working out of the box — they are what makes the MCP server
 * useful on a fresh install instead of exposing an empty tool list.
 *
 * Every name matches ^[a-z][a-z0-9_]*$ so it is directly exposable over MCP.
 *
 * `gate_advance` is deliberately stateless: it returns the receipt the engine WOULD issue,
 * without recording anything. An MCP tool may not carry state between calls, so writing
 * the event is the caller's job through packages/memory.
 */
export function buildToolRegistry(cwd = resolveProductRoot()): ToolRegistry {
  const registry = new ToolRegistry()

  const runEngine = async (op: string, input: unknown): Promise<unknown> => {
    const { EngineBridge } = await import('@dignityindexgate/engine-client')
    const bridge = new EngineBridge({
      module: ENGINE_MODULE,
      cwd: join(cwd, 'services', 'engine', 'src'),
    })
    return await bridge.call({ op, input })
  }

  const requireDeclaration = (input: unknown): Record<string, unknown> => {
    const declaration = (input as { declaration?: unknown }).declaration
    if (declaration === undefined || declaration === null) {
      throw new ValidationError('"declaration" is required', { field: 'declaration' })
    }
    if (typeof declaration !== 'object' || Array.isArray(declaration)) {
      throw new ValidationError('"declaration" must be an object', { field: 'declaration' })
    }
    return declaration as Record<string, unknown>
  }

  const requireState = (input: unknown): string => {
    const state = (input as { state?: unknown }).state
    if (typeof state !== 'string' || state.length === 0) {
      throw new ValidationError('"state" must be a non-empty string', { field: 'state' })
    }
    return state
  }

  const declarationSchema = {
    type: 'object',
    properties: {
      declaration: {
        type: 'object',
        description:
          'A declaration of the AI system: caseId, system, domain, decision, data, impact, evidence.',
      },
    },
    required: ['declaration'],
    additionalProperties: false,
  } as const

  registry.register(
    {
      name: 'list_skills',
      description:
        'List the skill catalog with each skill name, version and description. Use this to discover what the agent can do before guessing a command.',
      inputSchema: {
        type: 'object',
        properties: {
          includeBodies: { type: 'boolean', description: 'Include each skill body.' },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          issues: { type: 'array', items: { type: 'string' } },
          skills: { type: 'array', items: { type: 'object' } },
        },
        required: ['count', 'issues', 'skills'],
      },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async (input: { includeBodies?: boolean }) => {
        const { skills, issues } = loadCatalog(join(cwd, 'skills'))
        return {
          count: skills.length,
          issues: [...issues],
          skills: skills.map((skill) => ({
            name: skill.name,
            version: skill.version,
            description: skill.description,
            ...(input.includeBodies === true ? { body: skill.body } : {}),
          })),
        }
      },
    } satisfies Tool<{ includeBodies?: boolean }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'list_plugins',
      description:
        'List the resolved plugin registry, including plugins that were shadowed, disabled or rejected and why. Use this to explain why an expected capability is missing.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object' },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async () => {
        const result = buildRegistry(join(cwd, 'plugins'))
        return {
          active: result.active.map((plugin) => ({
            name: plugin.manifest.name,
            version: plugin.manifest.version,
            capabilities: plugin.manifest.capabilities,
            shadowed: plugin.shadowed,
          })),
          disabled: result.disabled.map((plugin) => plugin.manifest.name),
          rejected: result.rejected.map((plugin) => ({ path: plugin.path, issues: plugin.issues })),
        }
      },
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'gate_score',
      description:
        'Score a declared AI system and return the dignity index 0-100, its band, all six harm-class components with rationales, and every blocking and advisory finding. Deterministic: the same declaration always returns the same verdict.',
      inputSchema: declarationSchema,
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input: unknown) => await runEngine('score', requireDeclaration(input)),
    } satisfies Tool<unknown, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'gate_transitions',
      description:
        'List every transition the gate allows out of a state and every one it refuses, each refusal carrying a stable code such as MISSING_EVIDENCE or TRANSITION_ILLEGAL. Use this to find out what a case can legally do next before attempting it.',
      inputSchema: {
        type: 'object',
        properties: {
          declaration: { type: 'object' },
          state: { type: 'string', description: 'The current state, e.g. "draft".' },
        },
        required: ['declaration', 'state'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input: unknown) =>
        await runEngine('transitions', {
          declaration: requireDeclaration(input),
          state: requireState(input),
        }),
    } satisfies Tool<unknown, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'gate_advance',
      description:
        'Attempt one state transition and return either the receipt that would be issued or the refusal that stopped it. Stateless: nothing is recorded, so the caller decides whether to persist the event. Returns ok=false with a code when the edge is absent from the table or a guard fails.',
      inputSchema: {
        type: 'object',
        properties: {
          declaration: { type: 'object' },
          from: { type: 'string', description: 'Current state.' },
          to: { type: 'string', description: 'Requested state.' },
          actor: { type: 'string', description: 'Who is attempting the transition.' },
        },
        required: ['declaration', 'from', 'to', 'actor'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input: unknown) => {
        const record = input as { from?: unknown; to?: unknown; actor?: unknown }
        for (const field of ['from', 'to', 'actor'] as const) {
          if (typeof record[field] !== 'string' || record[field] === '') {
            throw new ValidationError(`"${field}" must be a non-empty string`, { field })
          }
        }
        return await runEngine('advance', {
          declaration: requireDeclaration(input),
          from: record.from,
          to: record.to,
          actor: record.actor,
        })
      },
    } satisfies Tool<unknown, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'gate_board',
      description:
        'Return every case in the review corpus grouped by state, with each dignity index, band, finding counts and legal next states. Use this to render or summarise the whole review board.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn', 'fs:read'],
      surface: 'core',
      handler: async () => await runEngine('board', { cases: loadCorpus(cwd) }),
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'gate_matrix',
      description:
        'Return the transition table itself: every state, every state pair marked legal or illegal, and the adjudication and release index floors. Use this to explain the gate policy without reading the source.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async () => await runEngine('matrix', null),
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'load_declaration',
      description:
        'Fetch one declaration from the review corpus by its caseId. Use this to obtain a real, well-formed declaration to pass to gate_score, gate_transitions or gate_advance instead of inventing one.',
      inputSchema: {
        type: 'object',
        properties: { caseId: { type: 'string', minLength: 1 } },
        required: ['caseId'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async (input: { caseId: string }) => {
        const cases = loadCorpus(cwd)
        const found = cases.find((entry) => entry.declaration.caseId === input.caseId)
        if (found === undefined) {
          const known = cases.map((entry) => entry.declaration.caseId)
          throw new ValidationError(
            `no case "${input.caseId}" in the corpus; known cases: ${known.join(', ')}`,
            { caseId: input.caseId, known },
          )
        }
        return { state: found.state, declaration: found.declaration }
      },
    } satisfies Tool<{ caseId: string }, unknown>,
    { source: 'core' },
  )

  return registry
}

/** A minimal, dependency-free logger for the tool context. */
export function createContext(requestId = 'cli'): ToolContext {
  return {
    requestId,
    now: () => Date.now(),
    log: (level, message, fields) => {
      process.stderr.write(`${JSON.stringify({ level, message, requestId, ...fields })}\n`)
    },
    dataDir: process.env.PRODUCT_DATA_DIR ?? '.data',
  }
}
