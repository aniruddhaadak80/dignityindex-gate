export default function Loading() {
  return (
    <section aria-busy="true" aria-live="polite">
      <div className="hero">
        <div className="skeleton" style={{ width: '6rem', height: '0.75rem' }} />
        <div className="skeleton" style={{ width: '22rem', height: '2.25rem' }} />
        <div className="skeleton" style={{ width: '30rem', height: '1.125rem' }} />
      </div>

      <div className="totals">
        {[0, 1, 2, 3].map((index) => (
          <div className="stat" key={index}>
            <div className="skeleton" style={{ width: '2.5rem', height: '1.375rem' }} />
            <div className="skeleton" style={{ width: '3.5rem' }} />
          </div>
        ))}
      </div>

      <div className="board">
        {[0, 1, 2].map((pane) => (
          <div className="pane" key={pane}>
            <div className="skeleton" style={{ width: '5rem', marginBottom: 'var(--space-3)' }} />
            {[0, 1, 2, 3].map((row) => (
              <div
                className="skeleton"
                key={row}
                style={{ width: `${88 - row * 9}%`, marginBottom: 'var(--space-2)' }}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
