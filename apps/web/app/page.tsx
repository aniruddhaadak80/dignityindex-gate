import Link from 'next/link'
import type { Metadata } from 'next'
import { CountUp } from '@/components/count-up'
import { TransitionRail } from '@/components/rail'
import { BAND_LABEL, bandTone, loadBoard, populatedStates, type Verdict } from '@/lib/board'
import { PRODUCT } from '@/lib/product'

export const metadata: Metadata = { title: 'Review board' }

function IndexMeter({ verdict }: { verdict: Verdict }) {
  const low = verdict.band === 'insufficient'
  return (
    <div>
      <p className="index-readout">
        <span className="index-value" data-low={String(low)}>
          <CountUp value={verdict.index} />
        </span>
        <span className="index-max">/ 100</span>
      </p>
      <div
        className="meter"
        role="meter"
        aria-valuenow={verdict.index}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`dignity index for ${verdict.system}`}
      >
        <div className="meter-fill" data-low={String(low)} style={{ width: `${verdict.index}%` }} />
      </div>
      <p className="floors">
        <span>adjudicate ≥ 50</span>
        <span>release ≥ 60</span>
      </p>
    </div>
  )
}

function Components({ verdict }: { verdict: Verdict }) {
  return (
    <ul className="components">
      {verdict.components.map((component) => (
        <li className="component" key={component.harmClass}>
          <span className="component-name">{component.harmClass}</span>
          <span className="component-score">
            {component.score} · w{component.weight}
          </span>
          <span className="component-rationale">{component.rationale}</span>
          <span className="component-bar">
            <span style={{ width: `${component.score}%` }} />
          </span>
        </li>
      ))}
    </ul>
  )
}

function Findings({ verdict }: { verdict: Verdict }) {
  const findings = [...verdict.blocking, ...verdict.advisory]
  if (findings.length === 0) {
    return (
      <p className="state" data-kind="empty">
        <span className="state-title">No findings.</span>
        Every harm class resolved and nothing was left advisory.
      </p>
    )
  }
  return (
    <ul className="findings">
      {findings.map((finding) => (
        <li className="finding" data-severity={finding.severity} key={finding.code + finding.message}>
          <span>{finding.message}</span>
          <code className="finding-code">{finding.code}</code>
        </li>
      ))}
    </ul>
  )
}

export default function BoardPage() {
  const result = loadBoard()

  // Three genuinely different designs for three genuinely different states.
  if (!result.ok) {
    return (
      <>
        <section className="hero">
          <span className="eyebrow">error</span>
          <h1>The board data is unusable</h1>
        </section>
        <div className="state" data-kind="error">
          <span className="state-title">{result.error}</span>
          The page renders committed engine output, and that output failed validation. This is never a loading
          state — the data is present but wrong.
          <code className="state-fix">npm run generate:web-data</code>
        </div>
      </>
    )
  }

  const data = result.data
  const occupied = populatedStates(data)
  const total = data.board.totals.cases ?? 0

  if (total === 0) {
    return (
      <>
        <section className="hero">
          <span className="eyebrow">empty</span>
          <h1>No cases under review</h1>
          <p>The board is ready and nothing has been filed against it yet.</p>
        </section>
        <p className="state" data-kind="empty">
          <span className="state-title">corpus/declarations.json holds no cases.</span>
          Add one, then regenerate.
          <code className="state-fix">npm run generate:web-data</code>
        </p>
      </>
    )
  }

  // The first case is the default selection. A board with a detail pane needs a subject.
  const selected = data.cases[0]!

  return (
    <>
      <section className="hero">
        <span className="eyebrow">v{PRODUCT.version} · review board</span>
        <h1>{PRODUCT.name}</h1>
        <p>
          Every index, band and refusal below was computed by <code>python -m dignityindex_gate</code> and
          committed as JSON. The gate refuses transitions that are absent from its table — those refusals are
          the product.
        </p>
      </section>

      <div className="totals">
        <div className="stat">
          <span className="stat-value">{total}</span>
          <span className="stat-label">cases</span>
        </div>
        <div className="stat">
          <span className="stat-value">
            <CountUp value={data.board.meanIndex} />
          </span>
          <span className="stat-label">mean index</span>
        </div>
        <div className="stat">
          <span className="stat-value">{data.board.totals.released ?? 0}</span>
          <span className="stat-label">released</span>
        </div>
        <div className="stat">
          <span className="stat-value">{data.board.totals.blocked ?? 0}</span>
          <span className="stat-label">blocked</span>
        </div>
        <div className="stat">
          <span className="stat-value">{data.board.totals.withBlockingFindings ?? 0}</span>
          <span className="stat-label">with blocking findings</span>
        </div>
      </div>

      <div className="board">
        {/* master */}
        <nav className="pane" aria-label="Cases">
          <h2>cases</h2>
          <ul className="case-list">
            {data.cases.map((entry) => (
              <li key={entry.caseId}>
                <Link
                  href={`/cases/${entry.caseId}`}
                  className="case-link"
                  aria-current={entry.caseId === selected.caseId}
                >
                  <span className="case-link-id">{entry.caseId}</span>
                  <span className="case-link-id">{entry.state}</span>
                  <span className="case-link-system">{entry.system}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* detail: the signature rail plus the case body */}
        <div className="pane">
          <TransitionRail states={data.matrix.states} transitions={selected.transitions} />

          <h2>declaration</h2>
          <dl className="kv">
            <dt>system</dt>
            <dd>{selected.system}</dd>
            <dt>domain</dt>
            <dd>{selected.domain}</dd>
            <dt>state</dt>
            <dd>{selected.state}</dd>
            <dt>releasable</dt>
            <dd>{selected.verdict.releasable ? 'yes' : 'no'}</dd>
            <dt>mandatory</dt>
            <dd>{selected.verdict.mandatory.join(', ')}</dd>
            <dt>evidenced</dt>
            <dd>
              {selected.verdict.evidenced.length === 0 ? 'none' : selected.verdict.evidenced.join(', ')}
            </dd>
          </dl>

          <h2>findings</h2>
          <Findings verdict={selected.verdict} />
        </div>

        {/* inspector */}
        <aside className="pane" aria-label={`Inspector for ${selected.caseId}`}>
          <h2>dignity index</h2>
          <IndexMeter verdict={selected.verdict} />
          <p>
            <span className="badge" data-tone={bandTone(selected.verdict.band)}>
              {BAND_LABEL[selected.verdict.band]}
            </span>
          </p>

          <h2>harm classes</h2>
          <Components verdict={selected.verdict} />

          <h2>board states in use</h2>
          <ul className="findings">
            {occupied.map((state) => (
              <li className="finding" key={state}>
                <span>
                  {state}: {(data.board.columns[state] ?? []).length} case(s)
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  )
}
