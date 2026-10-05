import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { CountUp } from '@/components/count-up'
import { TransitionRail } from '@/components/rail'
import { BAND_LABEL, bandTone, caseById, loadBoard } from '@/lib/board'

export const dynamic = 'force-static'

export function generateStaticParams() {
  const result = loadBoard()
  return result.ok ? result.data.cases.map((entry) => ({ caseId: entry.caseId })) : []
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ caseId: string }>
}): Promise<Metadata> {
  const { caseId } = await params
  const result = loadBoard()
  const entry = result.ok ? caseById(result.data, caseId) : undefined
  return { title: entry ? `${entry.caseId} — ${entry.system}` : 'Unknown case' }
}

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params
  const result = loadBoard()

  if (!result.ok) {
    return (
      <div className="state" data-kind="error">
        <span className="state-title">{result.error}</span>
        <code className="state-fix">npm run generate:web-data</code>
      </div>
    )
  }

  const entry = caseById(result.data, caseId)
  if (entry === undefined) notFound()

  const { verdict } = entry
  const low = verdict.band === 'insufficient'

  return (
    <>
      <section className="hero">
        <span className="eyebrow">
          {entry.caseId} · {entry.domain} · {entry.state}
        </span>
        <h1>{entry.system}</h1>
        <p>
          <Link href="/">← back to the board</Link>
        </p>
      </section>

      <div className="board">
        <div className="pane">
          <TransitionRail states={result.data.matrix.states} transitions={entry.transitions} />
        </div>

        <div className="pane">
          <h2>findings</h2>
          {[...verdict.blocking, ...verdict.advisory].length === 0 ? (
            <p className="state" data-kind="empty">
              <span className="state-title">No findings.</span>
            </p>
          ) : (
            <ul className="findings">
              {[...verdict.blocking, ...verdict.advisory].map((finding) => (
                <li className="finding" data-severity={finding.severity} key={finding.code + finding.message}>
                  <span>{finding.message}</span>
                  <code className="finding-code">{finding.code}</code>
                </li>
              ))}
            </ul>
          )}

          <h2>evidence</h2>
          <dl className="kv">
            <dt>mandatory</dt>
            <dd>{verdict.mandatory.join(', ')}</dd>
            <dt>evidenced</dt>
            <dd>{verdict.evidenced.length === 0 ? 'none' : verdict.evidenced.join(', ')}</dd>
          </dl>
        </div>

        <aside className="pane" aria-label="Inspector">
          <h2>dignity index</h2>
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
            aria-label={`dignity index for ${entry.system}`}
          >
            <div className="meter-fill" data-low={String(low)} style={{ width: `${verdict.index}%` }} />
          </div>
          <p>
            <span className="badge" data-tone={bandTone(verdict.band)}>
              {BAND_LABEL[verdict.band]}
            </span>
          </p>

          <h2>harm classes</h2>
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
        </aside>
      </div>
    </>
  )
}
