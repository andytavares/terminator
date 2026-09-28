import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { Power, Terminal } from 'lucide-react'
import { drawMonitorCase } from '../../factory/art/monitor.js'
import type { Paint, PaintGradient } from '../../factory/art/kit.js'
import type { NodeState } from '../../line/run-graph.js'
import type { TranscriptLine } from '../../runtime/transcript-excerpt.js'
import { stateWord } from '../../factory/callouts.js'

// One station's terminal, drawn as a green-phosphor monitor.
//
// The case is a canvas behind the screen, redrawn at the size the section is
// laid out at; the screen, the chin and every key are ordinary DOM on top, so
// the log is text a screen reader can read and the keys are real buttons.

export type MonitorStatus = 'running' | 'waiting' | 'failed' | 'gone' | 'idle'

export interface StationMonitorProps {
  readonly node: {
    readonly id: string
    readonly state: NodeState
    readonly attempts: number
    readonly role: string | null
  }
  readonly label: string
  /** The station's floor sign, for the chin's badge; the label stands in when it has none. */
  readonly sign: string | null
  readonly orderId: string
  readonly lines: readonly TranscriptLine[]
  readonly status: MonitorStatus
  readonly alert: string | null
  readonly attachProblem: string | null
  readonly onAttach: () => void
  readonly onClose: () => void
}

const LED_LABEL: Readonly<Record<MonitorStatus, string>> = {
  running: 'Working',
  waiting: 'Needs you',
  failed: 'Failed',
  gone: 'No agent',
  idle: 'Idle',
}

/** Art pixels are 3 screen pixels, 2 when the hall is too narrow for that. */
const PX = 3
const PX_NARROW = 2
const NARROW_FRAME_PX = 260
/** Below this many art pixels the case has no room to draw its edges. */
const MIN_ART_W = 30
const MIN_ART_H = 40
const POWER_OFF_MS = 300
const STICK_SLACK_PX = 4

function toPaint(ctx: CanvasRenderingContext2D): Paint {
  return {
    get fillStyle() {
      return ctx.fillStyle as unknown as string
    },
    set fillStyle(value: string | PaintGradient) {
      ctx.fillStyle = value as unknown as string
    },
    get globalCompositeOperation() {
      return ctx.globalCompositeOperation
    },
    set globalCompositeOperation(value: string) {
      ctx.globalCompositeOperation = value as GlobalCompositeOperation
    },
    fillRect: (x, y, w, h) => ctx.fillRect(x, y, w, h),
    createRadialGradient: (x0, y0, r0, x1, y1, r1) =>
      ctx.createRadialGradient(x0, y0, r0, x1, y1, r1),
    drawImage: (image, dx, dy) => ctx.drawImage(image, dx, dy),
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia !== undefined
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

function lineClass(line: TranscriptLine): 'tool' | 'say' | 'you' {
  if (line.kind === 'tool') return 'tool'
  return line.role === 'user' ? 'you' : 'say'
}

export function StationMonitor({
  node,
  label,
  sign,
  orderId,
  lines,
  status,
  alert,
  attachProblem,
  onAttach,
  onClose,
}: StationMonitorProps): JSX.Element {
  const rootRef = useRef<HTMLElement | null>(null)
  const caseRef = useRef<HTMLCanvasElement | null>(null)
  const logRef = useRef<HTMLPreElement | null>(null)
  const stuckRef = useRef(true)
  const closingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const headingId = `fdry-crt-${node.id}-h`

  // Redrawn at the size it is laid out at. Paint has no clearRect: assigning a
  // canvas its width is what empties it, even to the same value.
  useEffect(() => {
    const root = rootRef.current
    const canvas = caseRef.current
    if (root === null || canvas === null) return
    const fit = (): void => {
      const frame = root.parentElement
      const px = frame !== null && frame.clientWidth < NARROW_FRAME_PX ? PX_NARROW : PX
      root.style.setProperty('--px', `${px}px`)
      const w = Math.ceil(root.clientWidth / px)
      const h = Math.ceil(root.clientHeight / px)
      if (w < MIN_ART_W || h < MIN_ART_H) return
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (ctx === null) return
      drawMonitorCase(toPaint(ctx), w, h)
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (root === null || prefersReducedMotion()) return
    root.classList.add('is-on')
  }, [])

  useEffect(
    () => () => {
      if (closingRef.current !== null) clearTimeout(closingRef.current)
    },
    []
  )

  // Follow the newest line, unless the reader has scrolled up to read.
  useLayoutEffect(() => {
    const log = logRef.current
    if (log !== null && stuckRef.current) log.scrollTop = log.scrollHeight
  }, [lines, status])

  const onScroll = (): void => {
    const log = logRef.current
    if (log === null) return
    stuckRef.current = log.scrollHeight - log.scrollTop - log.clientHeight <= STICK_SLACK_PX
  }

  const powerOff = (): void => {
    const root = rootRef.current
    if (root === null || prefersReducedMotion()) {
      onClose()
      return
    }
    root.classList.remove('is-on')
    root.classList.add('is-off')
    closingRef.current = setTimeout(onClose, POWER_OFF_MS)
  }

  // The station's own standing first: a step can be running with nobody left
  // to run it, or running and waiting on you.
  const word =
    status === 'gone' ? 'No agent' : status === 'waiting' ? 'Needs you' : stateWord(node.state)
  const meta = [word, `attempt ${node.attempts}`, node.role]
    .filter((part) => part !== null)
    .join('  ')
    .toUpperCase()

  return (
    <section ref={rootRef} className="fdry-crt" data-state={status} aria-labelledby={headingId}>
      <canvas ref={caseRef} className="fdry-crt__case" aria-hidden="true" />
      <div className="fdry-crt__screen">
        <div className="fdry-crt__body">
          <div className="fdry-crt__title">
            <span>FOUNDRY LINE</span>
            <span>{orderId}</span>
          </div>
          <h3 id={headingId} className="fdry-crt__heading">
            {label.toUpperCase()}
          </h3>
          <div className="fdry-crt__meta">{meta}</div>
          {alert === null ? null : <div className="fdry-crt__alert">{alert}</div>}
          {attachProblem === null ? null : (
            <div className="fdry-crt__alert fdry-problem">{attachProblem}</div>
          )}
          <div className="fdry-crt__rule" aria-hidden="true">
            {'-'.repeat(80)}
          </div>
          <pre
            ref={logRef}
            className="fdry-crt__log"
            role="log"
            aria-label="Transcript"
            onScroll={onScroll}
          >
            {lines.length === 0 ? 'NOTHING YET.' : null}
            {lines.map((line, i) => (
              <React.Fragment key={`${line.at}:${i}`}>
                {i > 0 ? '\n' : null}
                <span className={lineClass(line)}>{line.text}</span>
              </React.Fragment>
            ))}
            {status === 'gone' ? (
              <>
                {'\n'}
                <span className="nocarrier">NO CARRIER</span>
              </>
            ) : null}
            {status === 'running' ? (
              <>
                {'\n'}
                <span className="fdry-crt__cursor" />
              </>
            ) : null}
          </pre>
        </div>
      </div>
      <div className="fdry-crt__chin">
        <span className="fdry-crt__badge">{(sign ?? label).toUpperCase()}</span>
        <span className="fdry-crt__spacer" />
        <span className="fdry-crt__led" role="img" aria-label={LED_LABEL[status]} />
        <button type="button" className="fdry-crt__key" onClick={onAttach}>
          <Terminal aria-hidden="true" />
          ATTACH
        </button>
        <button
          type="button"
          className="fdry-crt__power"
          aria-label="Close monitor"
          onClick={powerOff}
        >
          <Power aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}
