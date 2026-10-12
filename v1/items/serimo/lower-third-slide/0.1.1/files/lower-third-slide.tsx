import { gsap } from 'gsap'
import { useLayoutEffect, useRef } from 'react'

import './lower-third-slide.css'

export interface LowerThirdSlideProps {
  name: string
  subtitle: string
  durationSeconds: number
  placement?: 'top' | 'bottom'
  onReady: (timeline: gsap.core.Timeline) => void
}

export function LowerThirdSlide({
  name,
  subtitle,
  durationSeconds,
  placement = 'bottom',
  onReady
}: LowerThirdSlideProps) {
  const panel = useRef<HTMLDivElement>(null)
  if (!Number.isFinite(durationSeconds) || durationSeconds < 1)
    throw new RangeError('LowerThirdSlide needs at least 1 second')

  useLayoutEffect(() => {
    if (!panel.current) return
    const timeline = gsap.timeline({ paused: true })
    timeline.fromTo(
      panel.current,
      { x: -280, autoAlpha: 0 },
      { x: 0, autoAlpha: 1, duration: 0.5, ease: 'power2.out' },
      0
    )
    timeline.to(
      panel.current,
      { x: -280, autoAlpha: 0, duration: 0.5, ease: 'power2.in' },
      durationSeconds - 0.5
    )
    onReady(timeline)
    return () => {
      timeline.kill()
    }
  }, [durationSeconds, onReady])

  return (
    <div
      ref={panel}
      className={`serimo-lower-third serimo-lower-third--${placement}`}
      data-serimo-lower-third
    >
      <span className='serimo-lower-third__accent' aria-hidden='true' />
      <span className='serimo-lower-third__copy'>
        <strong>{name}</strong>
        <span>{subtitle}</span>
      </span>
    </div>
  )
}
