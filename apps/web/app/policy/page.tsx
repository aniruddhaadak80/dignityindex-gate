import type { Metadata } from 'next'
import { loadBoard } from '@/lib/board'

export const metadata: Metadata = { title: 'Policy' }
export const dynamic = 'force-static'

/**
 * The transition table as data: every state pair, marked legal or illegal.
 *
 * This page exists because the table is the authorisation model of the product, and an
 * authorisation model you cannot read is not one. It is rendered from the engine's own
 * `matrix` op, not from a table written out by hand in TypeScript.
 */
export default function PolicyPage() {
  const result = loadBoard()

  if (!result.ok) {
    return (
      <div className="state" data-kind="error">
        <span className="state-title">{result.error}</span>
        <code className="state-fix">npm run generate:web-data</code>
      </div>
    )
  }

  const { states, edges, floors, weights } = result.data.matrix
  const legalCount = edges.filter((edge) => edge.legal).length

  return (
    <>
      <section className="hero">
        <span className="eyebrow">policy</span>
        <h1>The transition table</h1>
        <p>
          {legalCount} permitted edges out of {edges.length} possible pairs. Anything absent is refused with{' '}
          <code>TRANSITION_ILLEGAL</code> — that is the whole authorisation model.
        </p>
      </section>

      <div className="board">
        <div className="pane">
          <h2>floors and weights</h2>
          <dl className="kv">
            <dt>adjudicate</dt>
            <dd>index ≥ {floors.adjudication}</dd>
            <dt>release</dt>
            <dd>index ≥ {floors.release}</dd>
            {Object.entries(weights).map(([harmClass, weight]) => (
              <span key={harmClass} style={{ display: 'contents' }}>
                <dt>{harmClass}</dt>
                <dd>weight {weight}</dd>
              </span>
            ))}
          </dl>
        </div>

        <div className="pane">
          <h2>state pairs</h2>
          <table className="matrix-table">
            <caption>
              rows are the current state, columns the requested state. Shaded cells are in the table; blank
              cells are refused.
            </caption>
            <thead>
              <tr>
                <th scope="col">from \ to</th>
                {states.map((state) => (
                  <th scope="col" key={state}>
                    {state}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {states.map((source) => (
                <tr key={source}>
                  <th scope="row">{source}</th>
                  {states.map((target) => {
                    const edge = edges.find(
                      (candidate) => candidate.source === source && candidate.target === target,
                    )
                    return (
                      <td key={target} data-legal={String(edge?.legal === true)}>
                        {edge?.legal === true ? 'permitted' : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="pane" aria-label="Reading the table">
          <h2>refusal codes</h2>
          <ul className="findings">
            <li className="finding">
              <span>The requested edge is not in the table at all.</span>
              <code className="finding-code">TRANSITION_ILLEGAL</code>
            </li>
            <li className="finding">
              <span>A mandatory harm class has no evidence reference.</span>
              <code className="finding-code">MISSING_EVIDENCE</code>
            </li>
            <li className="finding">
              <span>The index is below the floor for that transition.</span>
              <code className="finding-code">INDEX_BELOW_FLOOR</code>
            </li>
            <li className="finding">
              <span>A blocking finding is still open on the declaration.</span>
              <code className="finding-code">BLOCKING_FINDINGS</code>
            </li>
          </ul>
        </aside>
      </div>
    </>
  )
}
