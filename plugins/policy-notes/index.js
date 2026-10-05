/**
 * Annotates a refusal code with the policy clause behind it.
 *
 * The plugin gets no privileged path: it reads a refusal that the core registry already
 * produced and returns a display string. It cannot widen a permission, change a floor, or
 * make an illegal transition legal — those live in the engine, which is a pure function.
 */
const CLAUSES = {
  TRANSITION_ILLEGAL: 'Policy §2 — a case may only move along an edge in the transition table.',
  MISSING_EVIDENCE: 'Policy §3 — every mandatory harm class needs a reference before review starts.',
  INDEX_BELOW_FLOOR: 'Policy §4 — the dignity index floor for that transition.',
  BLOCKING_FINDINGS: 'Policy §5 — a blocking finding must be cleared at source, not waived.',
}

export const manifest = { name: 'policy-notes', version: '1.0.0' }

export function annotate(code) {
  return CLAUSES[code] ?? 'Policy §1 — no clause recorded for this code.'
}

export function describe() {
  return { plugin: manifest.name, capabilities: ['gate.policy.read'], clauses: Object.keys(CLAUSES) }
}
