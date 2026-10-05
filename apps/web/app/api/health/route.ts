import { NextResponse } from 'next/server'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PRODUCT, resolveVersion, SURFACES } from '@/lib/product'
import { loadBoard } from '@/lib/board'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Status = 'ok' | 'warn' | 'fail'
interface Check {
  name: string
  status: Status
  detail: string
  fix?: string
}

const startedAt = Date.now()

/**
 * A health endpoint that reports only things it can actually observe at runtime.
 *
 * The interesting probe is `board_data`: it re-validates the committed engine output with the
 * SAME validator the board route uses, so a stale or hand-edited board fails the health check
 * instead of rendering a plausible wrong page. A health check that cannot fail is decoration.
 */
function probe(): { ok: boolean; checks: Check[] } {
  const checks: Check[] = []

  const nodeMajor = Number(process.versions.node.split('.')[0] ?? '0')
  checks.push(
    nodeMajor >= 22
      ? { name: 'runtime', status: 'ok', detail: `node ${process.versions.node}` }
      : {
          name: 'runtime',
          status: 'fail',
          detail: `node ${process.versions.node} is below the required v22.12.0`,
          fix: 'target Node 22 in the deployment runtime',
        },
  )

  checks.push({ name: 'package', status: 'ok', detail: `${PRODUCT.slug}@${resolveVersion()}` })

  const region = process.env.VERCEL_REGION ?? 'local'
  checks.push({ name: 'region', status: 'ok', detail: region })

  const board = loadBoard()
  checks.push(
    board.ok
      ? {
          name: 'board_data',
          status: 'ok',
          detail: `${board.data.board.totals.cases ?? 0} cases, mean index ${board.data.board.meanIndex}`,
        }
      : {
          name: 'board_data',
          status: 'fail',
          detail: board.error,
          fix: 'run `npm run generate:web-data` and commit apps/web/lib/generated/board.json',
        },
  )

  const corpusPath = join(process.cwd(), 'corpus', 'declarations.json')
  if (!existsSync(corpusPath)) {
    // Expected on Vercel: the web app is deployed standalone and carries only the generated
    // artefact. Worth reporting, but never a failure of the deployment.
    checks.push({
      name: 'corpus_source',
      status: 'warn',
      detail: 'corpus/declarations.json is not present in this deployment',
      fix: 'expected on Vercel; locally it should exist',
    })
  } else {
    checks.push({
      name: 'corpus_source',
      status: 'ok',
      detail: `${Math.round(statSync(corpusPath).size / 1024)} KB`,
    })
  }

  const python = process.env.PYTHON ?? 'python'
  checks.push({
    name: 'engine',
    status: 'warn',
    detail: `the web bundle never spawns ${python}; engine calls happen in the CLI and MCP host`,
    fix: 'run the engine from the CLI: dignityindex-gate board',
  })

  const telemetry = process.env.TELEMETRY_ENABLED === 'true'
  checks.push({
    name: 'telemetry',
    status: 'warn',
    detail: telemetry ? 'enabled' : 'disabled (default)',
    ...(telemetry ? {} : { fix: 'set TELEMETRY_ENABLED=true to enable' }),
  })

  checks.push({
    name: 'surfaces',
    status: 'ok',
    detail: `${SURFACES.filter((s) => s.status === 'shipped').length} shipped, ${
      SURFACES.filter((s) => s.status === 'omitted').length
    } omitted`,
  })

  const ok = checks.every((check) => check.status !== 'fail')
  return { ok, checks }
}

export function GET() {
  const { ok, checks } = probe()
  return NextResponse.json(
    {
      ok,
      name: PRODUCT.slug,
      product: PRODUCT.name,
      version: resolveVersion(),
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
      runtime: process.versions.node,
      region: process.env.VERCEL_REGION ?? 'local',
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      checks,
    },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  )
}
