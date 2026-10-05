import type { Metadata } from 'next'
import { OMITTED_SURFACES, SURFACES } from '@/lib/product'

export const metadata: Metadata = { title: 'Surfaces' }

const TONE = { shipped: 'ok', omitted: 'warn' } as const

export default function SurfacesPage() {
  const shipped = SURFACES.filter((surface) => surface.status === 'shipped')

  return (
    <>
      <section className="hero">
        <span className="eyebrow">capability</span>
        <h1>Surfaces</h1>
        <p>
          Every capability in this product is a Tool in one registry, reachable identically from each surface
          below. A surface is a transport, never a second implementation.
        </p>
      </section>

      <section aria-labelledby="shipped-heading">
        <h2 id="shipped-heading" className="pane-title">
          shipped
        </h2>
        {shipped.length === 0 ? (
          <p className="state" data-kind="empty">
            <span className="state-title">No surfaces registered.</span>
          </p>
        ) : (
          <div className="board">
            {shipped.map((surface) => (
              <article className="pane" key={surface.id}>
                <span className="badge" data-tone={TONE[surface.status]}>
                  {surface.status}
                </span>
                <h3>{surface.title}</h3>
                <p>{surface.summary}</p>
                <code className="case-link-id">{surface.id}</code>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="omitted-heading" style={{ marginTop: 'var(--space-6)' }}>
        <h2 id="omitted-heading" className="pane-title">
          deliberately omitted
        </h2>
        <p style={{ color: 'var(--fg-muted)', marginTop: 0 }}>
          An omitted surface with a stated reason is a design decision. An omitted surface with no explanation
          is a gap.
        </p>
        {OMITTED_SURFACES.length === 0 ? (
          <p className="state" data-kind="empty">
            <span className="state-title">Nothing omitted.</span>
          </p>
        ) : (
          <div className="board">
            {OMITTED_SURFACES.map((surface) => (
              <article className="pane" key={surface.id}>
                <span className="badge" data-tone={TONE[surface.status]}>
                  {surface.status}
                </span>
                <h3>{surface.title}</h3>
                <p>{surface.reason}</p>
                <code className="case-link-id">{surface.id}</code>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
