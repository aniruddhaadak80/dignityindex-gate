import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { doctor, renderReport, type Check, type DoctorDeps } from './doctor.js'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const dirs: string[] = []

/** The healthy case, so a test can fail one probe and assert only on that row. */
const passing: DoctorDeps = {
  probeEngine: async () => ({ name: 'engine', status: 'ok', detail: '7 states' }),
  probeMemory: () => ({ name: 'memory', status: 'ok', detail: 'SQLite schema v3' }),
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'doctor-'))
  dirs.push(root)
  mkdirSync(join(root, 'skills', 'alpha'), { recursive: true })
  writeFileSync(
    join(root, 'skills', 'alpha', 'SKILL.md'),
    '---\nname: alpha\ndescription: A valid skill for the doctor test suite.\nmetadata:\n  version: 1.0.0\n---\nBody.\n',
    'utf8',
  )
  mkdirSync(join(root, 'corpus'), { recursive: true })
  writeFileSync(
    join(root, 'corpus', 'declarations.json'),
    JSON.stringify({ cases: [{ state: 'draft', declaration: { caseId: 'CASE-0001' } }] }),
    'utf8',
  )
  return root
}

const row = (checks: readonly Check[], name: string): Check | undefined =>
  checks.find((check) => check.name === name)

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('doctor', () => {
  it('passes on a well-formed tree', async () => {
    const report = await doctor(repo(), passing)
    expect(report.ok).toBe(true)
    expect(row(report.checks, 'skills')?.status).toBe('ok')
  })

  it('reports the engine, corpus and memory subsystems', async () => {
    const report = await doctor(repo(), passing)
    const names = report.checks.map((check) => check.name)
    expect(names).toContain('engine')
    expect(names).toContain('corpus')
    expect(names).toContain('memory')
  })

  it('fails and names a fix when a skill is invalid', async () => {
    const root = repo()
    mkdirSync(join(root, 'skills', 'broken'), { recursive: true })
    writeFileSync(join(root, 'skills', 'broken', 'SKILL.md'), 'no frontmatter', 'utf8')
    const report = await doctor(root, passing)
    expect(report.ok).toBe(false)
    const skills = row(report.checks, 'skills')
    expect(skills?.status).toBe('fail')
    expect(skills?.fix).toBeTruthy()
  })

  it('fails when the corpus file is missing', async () => {
    const root = mkdtempSync(join(tmpdir(), 'doctor-'))
    dirs.push(root)
    mkdirSync(join(root, 'skills'), { recursive: true })
    const report = await doctor(root, passing)
    const corpus = row(report.checks, 'corpus')
    expect(corpus?.status).toBe('fail')
    expect(corpus?.fix).toContain('corpus/declarations.json')
  })

  it('fails when the corpus holds no cases', async () => {
    const root = repo()
    writeFileSync(join(root, 'corpus', 'declarations.json'), JSON.stringify({ cases: [] }), 'utf8')
    const report = await doctor(root, passing)
    expect(row(report.checks, 'corpus')?.status).toBe('fail')
    expect(row(report.checks, 'corpus')?.fix).toContain('generate:web-data')
  })

  it('carries the engine failure through as a row, not an exception', async () => {
    const report = await doctor(repo(), {
      probeEngine: async () => ({
        name: 'engine',
        status: 'fail',
        detail: 'spawn python ENOENT',
        fix: 'install Python',
      }),
      probeMemory: passing.probeMemory as () => Check,
    })
    expect(report.ok).toBe(false)
    expect(row(report.checks, 'engine')?.status).toBe('fail')
    expect(row(report.checks, 'engine')?.fix).toBe('install Python')
  })

  it('never throws when a probe itself explodes', async () => {
    const report = await doctor(repo(), {
      probeEngine: async () => {
        throw new Error('probe exploded')
      },
      probeMemory: passing.probeMemory as () => Check,
    })
    expect(report.ok).toBe(false)
  })

  it('warns rather than fails when config is absent', async () => {
    const report = await doctor(repo(), passing)
    expect(row(report.checks, 'config')?.status).toBe('warn')
    expect(report.ok).toBe(true)
  })

  it('renders every check with a status token', async () => {
    const rendered = renderReport(await doctor(repo(), passing))
    expect(rendered).toMatch(/doctor/)
    expect(rendered).toMatch(/\[PASS\]/)
    expect(rendered).toMatch(/\[WARN\]/)
  })

  it('agrees with the real engine against the repository root', async () => {
    // The one test that refuses injected probes: the shipped probes must actually work here.
    const report = await doctor(REPO_ROOT)
    expect(row(report.checks, 'engine')?.status).toBe('ok')
    expect(row(report.checks, 'corpus')?.status).toBe('ok')
    expect(row(report.checks, 'memory')?.status).toBe('ok')
    expect(report.ok).toBe(true)
  })
})
