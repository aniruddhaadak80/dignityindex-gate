import type { CaseTransitions } from '@/lib/board'

/**
 * THE SIGNATURE ELEMENT.
 *
 * Seven states in rail order. The current state is filled; states the gate will actually let
 * this case move to are ringed; and everything the gate refuses is listed beneath, struck
 * through, in coral, each with the reason code that refused it.
 *
 * The design intent: a screenshot of this product should be identifiable by what it FORBIDS,
 * not by a headline. So the refusal row is given the visual weight and the legal edges are
 * given almost none.
 *
 * A server component — the rail is fully rendered in the initial HTML, with no client JS.
 */
export function TransitionRail({
  states,
  transitions,
}: {
  readonly states: readonly string[]
  readonly transitions: CaseTransitions
}) {
  const legal = new Set(transitions.legal)
  const refusals = transitions.refused

  return (
    <section aria-labelledby="rail-heading">
      <h2 id="rail-heading" className="pane-title">
        transition rail
      </h2>

      <ol className="rail">
        {states.map((state) => {
          const isHere = state === transitions.state
          const reachable = legal.has(state)
          return (
            <li
              className="rail-node"
              key={state}
              data-here={String(isHere)}
              data-reachable={String(reachable)}
            >
              <span className="rail-dot" aria-hidden="true" />
              <span className="rail-state">{state}</span>
              <span className="visually-hidden">
                {isHere ? ' (current state)' : reachable ? ' (permitted)' : ' (not permitted)'}
              </span>
            </li>
          )
        })}
      </ol>

      {refusals.length === 0 ? (
        <p className="state" data-kind="empty">
          <span className="state-title">Nothing is refused from here.</span>
          Every transition out of <code>{transitions.state}</code> is permitted by the table.
        </p>
      ) : (
        <ul className="refusals">
          {refusals.map((refusal) => (
            <li className="refusal" key={`${transitions.state}-${refusal.target}`}>
              <span className="refusal-target">{refusal.target}</span>
              <span className="refusal-why">
                {refusal.message}
                <code className="refusal-code">{refusal.code}</code>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
