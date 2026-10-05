import generated from './generated/board.json'

/**
 * The typed data layer.
 *
 * This app depends on NO workspace package (ADR 0003), so it cannot import packages/memory
 * or spawn the Python engine. It does NOT recompute the dignity index either — that would be
 * a second implementation of the credibility core, which the narrow waist forbids.
 *
 * Every number rendered below was produced by `python -m dignityindex_gate` and committed to
 * lib/generated/board.json. `npm run check:generated-web-data` regenerates and byte-compares,
 * so this file cannot drift from the engine.
 */

export type Band = 'clear' | 'contested-review' | 'insufficient'

export interface Component {
  readonly harmClass: string
  readonly weight: number
  readonly score: number
  readonly rationale: string
}

export interface Finding {
  readonly code: string
  readonly severity: string
  readonly message: string
}

export interface Verdict {
  readonly caseId: string
  readonly domain: string
  readonly system: string
  readonly index: number
  readonly band: Band
  readonly releasable: boolean
  readonly components: readonly Component[]
  readonly blocking: readonly Finding[]
  readonly advisory: readonly Finding[]
  readonly mandatory: readonly string[]
  readonly evidenced: readonly string[]
}

export interface RefusedEdge {
  readonly target: string
  readonly code: string
  readonly message: string
}

export interface CaseTransitions {
  readonly state: string
  readonly legal: readonly string[]
  readonly refused: readonly RefusedEdge[]
}

export interface BoardRow {
  readonly caseId: string
  readonly system: string
  readonly domain: string
  readonly state: string
  readonly index: number
  readonly band: Band
  readonly blocking: number
  readonly advisory: number
  readonly releasable: boolean
  readonly next: readonly string[]
}

export interface BoardData {
  readonly generatedBy: string
  readonly note: string
  readonly matrix: {
    readonly states: readonly string[]
    readonly edges: readonly { source: string; target: string; legal: boolean }[]
    readonly floors: { adjudication: number; release: number }
    readonly weights: Readonly<Record<string, number>>
  }
  readonly board: {
    readonly columns: Readonly<Record<string, readonly BoardRow[]>>
    readonly states: readonly string[]
    readonly totals: Readonly<Record<string, number>>
    readonly meanIndex: number
  }
  readonly cases: readonly {
    readonly caseId: string
    readonly state: string
    readonly system: string
    readonly domain: string
    readonly verdict: Verdict
    readonly transitions: CaseTransitions
  }[]
}

export type LoadResult =
  { readonly ok: true; readonly data: BoardData } | { readonly ok: false; readonly error: string }

/**
 * Validates the generated payload rather than trusting it. A committed JSON file that has
 * drifted or been hand-edited must surface as an error state, not as a blank board.
 */
export function loadBoard(): LoadResult {
  const data = generated as unknown as BoardData

  if (!Array.isArray(data.cases) || data.cases.length === 0) {
    return { ok: false, error: 'the generated board contains no cases' }
  }
  if (!Array.isArray(data.matrix?.states) || data.matrix.states.length === 0) {
    return { ok: false, error: 'the generated board contains no transition table' }
  }
  for (const entry of data.cases) {
    if (typeof entry.verdict?.index !== 'number') {
      return { ok: false, error: `case ${entry.caseId ?? '(unknown)'} has no verdict index` }
    }
    if (!Array.isArray(entry.verdict.components)) {
      return { ok: false, error: `case ${entry.caseId} has no harm-class components` }
    }
  }

  return { ok: true, data }
}

export function caseById(data: BoardData, caseId: string) {
  return data.cases.find((entry) => entry.caseId === caseId)
}

/** The states that hold at least one case, for the board's column strip. */
export function populatedStates(data: BoardData): readonly string[] {
  return data.board.states.filter((state) => (data.board.columns[state] ?? []).length > 0)
}

export const BAND_LABEL: Readonly<Record<Band, string>> = {
  clear: 'clear to release',
  'contested-review': 'contested review',
  insufficient: 'insufficient',
}

/** Severity → the tone attribute the badge uses. Kept here so no route invents its own. */
export function bandTone(band: Band): 'ok' | 'warn' | 'danger' {
  if (band === 'clear') return 'ok'
  return band === 'contested-review' ? 'warn' : 'danger'
}
