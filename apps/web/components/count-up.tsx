'use client'

import { useEffect, useRef, useState } from 'react'

interface CountUpProps {
  readonly value: number
  readonly durationMs?: number
}

/**
 * The count-up is this product's motion signature: an index arrives as a number that climbs
 * into place, so the reader sees it as a measurement rather than as text.
 *
 * It is also the one place a client component is justified. The first paint must already
 * contain the real value in the server-rendered HTML — which it does, because the initial
 * state IS the value — so this never gates content on JavaScript.
 *
 * Honours prefers-reduced-motion by jumping straight to the final value.
 */
export function CountUp({ value, durationMs = 700 }: CountUpProps) {
  const [shown, setShown] = useState(value)
  const frame = useRef<number | undefined>(undefined)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced || durationMs <= 0) {
      setShown(value)
      return
    }

    const start = performance.now()
    const from = shown

    const tick = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(1, elapsed / durationMs)
      // easeOutCubic: fast start, settled finish — reads as a measurement locking in.
      const eased = 1 - (1 - progress) ** 3
      setShown(Math.round(from + (value - from) * eased))
      if (progress < 1) frame.current = requestAnimationFrame(tick)
    }

    frame.current = requestAnimationFrame(tick)
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    }
    // `from` is intentionally read once: re-running on every shown value would restart the
    // animation each frame it produces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs])

  return <>{shown}</>
}
