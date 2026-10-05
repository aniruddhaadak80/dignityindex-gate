import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog } from '@dignityindexgate/skills'
import { buildRegistry as buildPluginRegistry } from '@dignityindexgate/plugins'
import { Store, LATEST_VERSION } from '@dignityindexgate/memory'
import { loadCorpus, resolveProductRoot, CORPUS_PATH } from './bootstrap.js'

export type Status = 'ok' | 'warn' | 'fail'

export interface Check {
  readonly name: string
  readonly status: Status
  readonly detail: string
  readonly fix?: string
}

export interface DoctorReport {
  readonly ok: boolean
  readonly checks: readonly Check[]
}

const pkg = { name: 'dignityindex-gate', version: '0.1.0' }

/**
 * Probes the deterministic engine with the cheapest real operation. A version string
 * reported by a constant is not a probe; this actually spawns Python and round-trips JSON.
 */
async function probeEngine(cwd: string): Promise<Check> {
  try {
    const { EngineBridge } = await import('@dignityindexgate/engine-client')
    const bridge = new EngineBridge({
      module: 'dignityindex_gate',
      python: process.env.PYTHON ?? 'python',
      cwd: join(cwd, 'services', 'engine', 'src'),
      timeoutMs: 15_000,
    })
    const result = (await bridge.call({ op: 'matrix', input: null })) as {
      states?: string[]
    }
    const states = result.states ?? []
    if (states.length === 0) {
      return {
        name: 'engine',
        status: 'fail',
        detail: 'the engine answered but returned no states',
        fix: 'run: echo \'{"op":"matrix","input":null}\' | python -m dignityindex_gate',
      }
    }
    return {
      name: 'engine',
      status: 'ok',
      detail: `${states.length} states in the transition table`,
    }
  } catch (cause) {
    return {
      name: 'engine',
      status: 'fail',
      detail: String(cause),
      fix: 'ensure Python 3.11+ is on PATH and services/engine/src is importable',
    }
  }
}

function probeMemory(): Check {
  let store: Store | undefined
  try {
    store = new Store(':memory:')
    const version = store.version
    if (store.isPending) {
      return {
        name: 'memory',
        status: 'fail',
        detail: `schema at v${version}, migrations pending up to v${LATEST_VERSION}`,
        fix: 'run the Store constructor against a writable path, or re-run migrate()',
      }
    }
    return { name: 'memory', status: 'ok', detail: `SQLite schema v${version}, no pending migrations` }
  } catch (cause) {
    return {
      name: 'memory',
      status: 'fail',
      detail: String(cause),
      fix: 'rebuild the native module: npm rebuild better-sqlite3',
    }
  } finally {
    store?.close()
  }
}

/**
 * Probes are injectable so both the pass and the fail path are directly testable without a
 * test-only environment escape hatch. The defaults are the real probes.
 */
export interface DoctorDeps {
  readonly probeEngine?: (cwd: string) => Promise<Check>
  readonly probeMemory?: () => Check
}

/**
 * The flagship command. An agent that mutates its own configuration must be able to
 * diagnose itself, and every failing row carries a fix hint rather than only a status.
 *
 * Never throws: a failing subsystem becomes a row, because a diagnostic that crashes is
 * useless exactly when it is needed.
 */
export async function doctor(cwd = resolveProductRoot(), deps: DoctorDeps = {}): Promise<DoctorReport> {
  const engineProbe = deps.probeEngine ?? probeEngine
  const memoryProbe = deps.probeMemory ?? probeMemory
  const checks: Check[] = []

  const nodeMajor = Number(process.versions.node.split('.')[0])
  checks.push(
    nodeMajor >= 22
      ? { name: 'node', status: 'ok', detail: `v${process.versions.node}` }
      : {
          name: 'node',
          status: 'fail',
          detail: `v${process.versions.node} is below the required v22.12.0`,
          fix: 'install Node 22.12 or newer (see .nvmrc)',
        },
  )

  checks.push({
    name: 'package',
    status: 'ok',
    detail: `${pkg.name}@${pkg.version}`,
  })

  const skills = loadCatalog(join(cwd, 'skills'))
  checks.push(
    skills.issues.length === 0
      ? { name: 'skills', status: 'ok', detail: `${skills.skills.length} skills, 0 invalid` }
      : {
          name: 'skills',
          status: 'fail',
          detail: `${skills.skills.length} valid, ${skills.issues.length} invalid`,
          fix: skills.issues[0] ?? 'see npm run check:skill-version',
        },
  )

  const plugins = buildPluginRegistry(join(cwd, 'plugins'))
  checks.push(
    plugins.rejected.length === 0
      ? {
          name: 'plugins',
          status: 'ok',
          detail: `${plugins.active.length} active, ${plugins.disabled.length} disabled`,
        }
      : {
          name: 'plugins',
          status: 'warn',
          detail: `${plugins.rejected.length} rejected`,
          fix: plugins.rejected[0]?.issues[0] ?? 'inspect plugins/*/plugin.json',
        },
  )

  try {
    const cases = loadCorpus(cwd)
    checks.push(
      cases.length === 0
        ? {
            name: 'corpus',
            status: 'fail',
            detail: `${CORPUS_PATH} contains no cases`,
            fix: 'add at least one case, then run npm run generate:web-data',
          }
        : {
            name: 'corpus',
            status: 'ok',
            detail: `${cases.length} review cases in ${CORPUS_PATH}`,
          },
    )
  } catch (cause) {
    checks.push({
      name: 'corpus',
      status: 'fail',
      detail: String(cause),
      fix: `restore ${CORPUS_PATH}`,
    })
  }

  // The never-throws guarantee is enforced here rather than assumed of each probe, so it
  // holds for an injected probe too. A diagnostic that crashes is useless precisely when
  // it is needed.
  try {
    checks.push(await engineProbe(cwd))
  } catch (cause) {
    checks.push({
      name: 'engine',
      status: 'fail',
      detail: `probe threw: ${String(cause)}`,
      fix: 'run: dignityindex-gate tools --json  and check the engine bridge',
    })
  }

  try {
    checks.push(memoryProbe())
  } catch (cause) {
    checks.push({
      name: 'memory',
      status: 'fail',
      detail: `probe threw: ${String(cause)}`,
      fix: 'rebuild the native module: npm rebuild better-sqlite3',
    })
  }

  const configPath = join(cwd, 'product.config.json')
  checks.push(
    existsSync(configPath)
      ? { name: 'config', status: 'ok', detail: 'product.config.json found' }
      : {
          name: 'config',
          status: 'warn',
          detail: 'no product.config.json — using defaults',
          fix: 'run with defaults, or create product.config.json from product.config.json.example',
        },
  )

  return { ok: checks.every((check) => check.status !== 'fail'), checks }
}

export function renderReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((check) => check.name.length), 5)
  const icon = (status: Status): string => (status === 'ok' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL')
  const lines = report.checks.map((check) => {
    const head = `  [${icon(check.status)}] ${check.name.padEnd(width)}  ${check.detail}`
    return check.fix === undefined ? head : `${head}\n         fix: ${check.fix}`
  })
  return [
    `${pkg.name} doctor`,
    ...lines,
    '',
    report.ok ? 'all required checks passed' : 'one or more checks failed',
  ].join('\n')
}
