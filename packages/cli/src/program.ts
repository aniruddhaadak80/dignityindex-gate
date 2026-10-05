import { Command } from 'commander'
import { buildToolRegistry, createContext, CORPUS_PATH, loadCorpus } from './bootstrap.js'
import { doctor, renderReport } from './doctor.js'

const VERSION = '0.1.0'

/** Permissions the local CLI grants when it invokes a tool directly. */
const CLI_PERMISSIONS = ['fs:read', 'net:fetch', 'proc:spawn'] as const

function wantsJson(): boolean {
  return process.argv.includes('--json')
}

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

/** Exit codes are part of the contract: 0 ok, 1 runtime failure, 2 usage error. */
export function buildProgram(): Command {
  const program = new Command()

  program
    .name('dignityindex-gate')
    .description(
      'Dignity Index Gate — Turn a declared AI deployment into a release verdict, and name the exact transition that blocked it.',
    )
    .version(VERSION, '-v, --version', 'print the version')
    .exitOverride((error) => {
      process.exitCode = error.exitCode === 0 ? 0 : 2
      throw error
    })

  program
    .command('doctor')
    .description('diagnose every subsystem and print an actionable report')
    .option('--json', 'machine-readable output')
    .action(async () => {
      const report = await doctor()
      process.stdout.write(wantsJson() ? `${JSON.stringify(report, null, 2)}\n` : `${renderReport(report)}\n`)
      if (!report.ok) process.exitCode = 1
    })

  program
    .command('tools')
    .description('list the registered tools — the authoritative capability list')
    .option('--json', 'machine-readable output')
    .action(() => {
      const registry = buildToolRegistry()
      const tools = registry.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        surface: registry.surfaceOf(tool.name),
        source: registry.sourceOf(tool.name),
        permissions: tool.permissions,
        inputSchema: tool.inputSchema,
      }))
      if (wantsJson()) {
        writeJson(tools)
        return
      }
      const width = Math.max(...tools.map((tool) => tool.name.length), 4)
      for (const tool of tools) {
        process.stdout.write(`  ${tool.name.padEnd(width)}  [${tool.surface}]  ${tool.description}\n`)
      }
    })

  program
    .command('skills')
    .description('list the skill catalog with every validation issue')
    .option('--json', 'machine-readable output')
    .action(async () => {
      const { loadCatalog } = await import('@dignityindexgate/skills')
      const { skills, issues } = loadCatalog('skills')
      if (wantsJson()) {
        writeJson({
          count: skills.length,
          issues,
          skills: skills.map((skill) => ({
            name: skill.name,
            version: skill.version,
            description: skill.description,
          })),
        })
        return
      }
      for (const skill of skills) {
        process.stdout.write(`  ${skill.name}@${skill.version}  ${skill.description}\n`)
      }
      for (const issue of issues) process.stdout.write(`  ! ${issue}\n`)
    })

  program
    .command('plugins')
    .description('show the resolved plugin registry, including every rejection')
    .option('--json', 'machine-readable output')
    .action(async () => {
      const registry = buildToolRegistry()
      const result = (await registry.invoke('list_plugins', {}, createContext('cli'), ['fs:read'])) as {
        active: { name: string; version: string; capabilities: string[]; shadowed: string[] }[]
        disabled: string[]
        rejected: { path: string; issues: string[] }[]
      }
      if (wantsJson()) {
        writeJson(result)
        return
      }
      for (const plugin of result.active) {
        const shadowed = plugin.shadowed.length > 0 ? ` (shadows ${plugin.shadowed.join(', ')})` : ''
        process.stdout.write(
          `  ${plugin.name}@${plugin.version}  [${plugin.capabilities.join(', ')}]${shadowed}\n`,
        )
      }
      for (const plugin of result.disabled) process.stdout.write(`  ${plugin}  (disabled)\n`)
      for (const rejection of result.rejected) {
        process.stdout.write(`  ${rejection.path}  rejected: ${rejection.issues.join('; ')}\n`)
      }
    })

  program
    .command('board')
    .description('render the review board: every case, its state, index and findings')
    .option('--json', 'machine-readable output')
    .action(async () => {
      const registry = buildToolRegistry()
      const board = (await registry.invoke('gate_board', {}, createContext('cli'), [
        'fs:read',
        'proc:spawn',
      ])) as {
        columns: Record<string, { caseId: string; index: number; band: string; blocking: number }[]>
        totals: Record<string, number>
        meanIndex: number
      }

      if (wantsJson()) {
        writeJson(board)
        return
      }

      process.stdout.write(`review board  (mean index ${board.meanIndex})\n\n`)
      for (const [state, rows] of Object.entries(board.columns)) {
        if (rows.length === 0) continue
        process.stdout.write(`  ${state} (${rows.length})\n`)
        for (const row of rows) {
          const flag = row.blocking > 0 ? `  ${row.blocking} blocking` : ''
          process.stdout.write(
            `    ${row.caseId}  index ${String(row.index).padStart(3)}  ${row.band}${flag}\n`,
          )
        }
      }
      process.stdout.write(
        `\n  ${board.totals.cases ?? 0} cases, ${board.totals.released ?? 0} released, ` +
          `${board.totals.blocked ?? 0} blocked, ${board.totals.withBlockingFindings ?? 0} with blocking findings\n`,
      )
    })

  program
    .command('cases')
    .description('list the corpus declarations available to score')
    .option('--json', 'machine-readable output')
    .action(() => {
      const cases = loadCorpus()
      if (wantsJson()) {
        writeJson(
          cases.map((entry) => ({
            caseId: entry.declaration.caseId,
            system: entry.declaration.system,
            domain: entry.declaration.domain,
            state: entry.state,
          })),
        )
        return
      }
      for (const entry of cases) {
        process.stdout.write(
          `  ${entry.declaration.caseId}  ${entry.state.padEnd(12)} ${entry.declaration.domain.padEnd(15)} ${entry.declaration.system}\n`,
        )
      }
      process.stdout.write(`\n  corpus: ${CORPUS_PATH}\n`)
    })

  program
    .command('run')
    .description('invoke one tool directly, without MCP')
    .argument('<tool>', 'tool name')
    .argument('<input>', 'JSON input document')
    .action(async (tool: string, raw: string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (cause) {
        process.stderr.write(`error: input is not valid JSON — ${String(cause)}\n`)
        process.exitCode = 2
        return
      }
      const registry = buildToolRegistry()
      try {
        const value = await registry.invoke(tool, parsed, createContext('cli'), [...CLI_PERMISSIONS])
        writeJson(value ?? null)
      } catch (cause) {
        const code = (cause as { code?: string }).code ?? 'INTERNAL'
        process.stderr.write(`${code}: ${cause instanceof Error ? cause.message : String(cause)}\n`)
        process.exitCode = 1
      }
    })

  const mcp = program.command('mcp').description('Model Context Protocol commands')

  mcp
    .command('serve')
    .description('run the MCP server over stdio')
    .action(async () => {
      const { serveStdio } = await import('@dignityindexgate/mcp')
      const registry = buildToolRegistry()
      // stdout belongs to the protocol from here on; diagnostics must go to stderr.
      await serveStdio(registry, createContext('mcp'))
    })

  mcp
    .command('call')
    .description('invoke one tool directly, without MCP')
    .argument('<tool>', 'tool name')
    .argument('<input>', 'JSON input document')
    .action(async (tool: string, raw: string) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch (cause) {
        process.stderr.write(`error: input is not valid JSON — ${String(cause)}\n`)
        process.exitCode = 2
        return
      }
      const registry = buildToolRegistry()
      try {
        const value = await registry.invoke(tool, parsed, createContext('cli'), [...CLI_PERMISSIONS])
        writeJson(value ?? null)
      } catch (cause) {
        const code = (cause as { code?: string }).code ?? 'INTERNAL'
        process.stderr.write(`${code}: ${cause instanceof Error ? cause.message : String(cause)}\n`)
        process.exitCode = 1
      }
    })

  program
    .command('version')
    .description('print version and runtime information as JSON')
    .action(() => {
      writeJson({
        name: 'dignityindex-gate',
        version: VERSION,
        node: process.versions.node,
        platform: process.platform,
        tools: buildToolRegistry().size,
        cases: loadCorpus().length,
      })
    })

  return program
}
