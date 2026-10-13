import React, { useEffect, useLayoutEffect, useRef } from 'react'
import { Power, Terminal } from 'lucide-react'
import { drawMonitorCase } from '../../factory/art/monitor.js'
import type { NodeState } from '../../line/run-graph.js'
import type { TranscriptLine } from '../../runtime/transcript-excerpt.js'
import { stateWord } from '../../factory/callouts.js'
import { prefersReducedMotion, toPaint } from './canvas.js'

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
  /**
   * What a step with no agent decided, one line each. Non-null marks the step
   * automatic: no attempt count, no transcript, no attach key.
   */
  readonly facts?: readonly string[] | null
  /** False once the step's agent has closed: the key stays, disabled, and says why. */
  readonly attachable?: boolean
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

function lineClass(line: TranscriptLine): 'tool' | 'say' | 'you' {
  if (line.kind === 'tool') return 'tool'
  return line.role === 'user' ? 'you' : 'say'
}

/**
 * Draws the case at the size the section is laid out at. Paint has no
 * clearRect: assigning a canvas its width is what empties it, even to the
 * same value.
 */
function fitCase(root: HTMLElement, canvas: HTMLCanvasElement): void {
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

type ElementRef<T> = React.MutableRefObject<T | null>

/** The case, redrawn whenever the section is laid out at another size. */
function useCaseFit(rootRef: ElementRef<HTMLElement>, caseRef: ElementRef<HTMLCanvasElement>) {
  useEffect(() => {
    const root = rootRef.current
    const canvas = caseRef.current
    if (root === null || canvas === null) return
    const fit = (): void => fitCase(root, canvas)
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(root)
    return () => observer.disconnect()
  }, [rootRef, caseRef])
}

/** The screen warms up when the monitor opens, unless less motion was asked for. */
function usePowerOn(rootRef: ElementRef<HTMLElement>): void {
  useEffect(() => {
    const root = rootRef.current
    if (root === null || prefersReducedMotion()) return
    root.classList.add('is-on')
  }, [rootRef])
}

/** A close still powering down when the monitor goes is not finished afterwards. */
function useClearOnUnmount(closingRef: ElementRef<ReturnType<typeof setTimeout>>): void {
  useEffect(
    () => () => {
      if (closingRef.current !== null) clearTimeout(closingRef.current)
    },
    [closingRef]
  )
}

interface FollowDeps {
  readonly lines: readonly TranscriptLine[]
  readonly status: MonitorStatus
}

/**
 * Follow the newest line, unless the reader has scrolled up to read; the
 * scroll handler that notices which.
 */
function useFollowLog(logRef: ElementRef<HTMLPreElement>, { lines, status }: FollowDeps) {
  const stuckRef = useRef(true)
  useLayoutEffect(() => {
    const log = logRef.current
    if (log !== null && stuckRef.current) log.scrollTop = log.scrollHeight
  }, [lines, status, logRef])
  return (): void => {
    const log = logRef.current
    if (log !== null) stuckRef.current = atFoot(log)
  }
}

/** Whether the log is scrolled to its foot, give or take a few pixels. */
function atFoot(log: HTMLPreElement): boolean {
  return log.scrollHeight - log.scrollTop - log.clientHeight <= STICK_SLACK_PX
}

/** Powers the screen off, then closes; closes at once for someone who asked for less motion. */
function powerOff(
  rootRef: ElementRef<HTMLElement>,
  closingRef: ElementRef<ReturnType<typeof setTimeout>>,
  onClose: () => void
): void {
  const root = rootRef.current
  if (root === null || prefersReducedMotion()) {
    onClose()
    return
  }
  root.classList.remove('is-on')
  root.classList.add('is-off')
  closingRef.current = setTimeout(onClose, POWER_OFF_MS)
}

/**
 * The station's own standing first — a step can be running with nobody left
 * to run it, or running and waiting on you — then its attempt and role.
 */
function metaLine(
  node: StationMonitorProps['node'],
  { status, automatic }: { status: MonitorStatus; automatic: boolean }
): string {
  const word =
    status === 'gone' ? 'No agent' : status === 'waiting' ? 'Needs you' : stateWord(node.state)
  return [word, automatic ? null : `attempt ${node.attempts}`, node.role]
    .filter((part) => part !== null)
    .join('  ')
    .toUpperCase()
}

export function StationMonitor(props: StationMonitorProps): JSX.Element {
  const { node, status, facts = null, onClose } = props
  const rootRef = useRef<HTMLElement | null>(null)
  const caseRef = useRef<HTMLCanvasElement | null>(null)
  const logRef = useRef<HTMLPreElement | null>(null)
  const closingRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const headingId = `fdry-crt-${node.id}-h`
  useCaseFit(rootRef, caseRef)
  usePowerOn(rootRef)
  useClearOnUnmount(closingRef)
  const onScroll = useFollowLog(logRef, { lines: props.lines, status })
  return (
    <section ref={rootRef} className="fdry-crt" data-state={status} aria-labelledby={headingId}>
      <canvas ref={caseRef} className="fdry-crt__case" aria-hidden="true" />
      <MonitorScreen
        {...props}
        facts={facts}
        headingId={headingId}
        logRef={logRef}
        onScroll={onScroll}
      />
      <MonitorChin
        {...props}
        automatic={facts !== null}
        onPower={() => powerOff(rootRef, closingRef, onClose)}
      />
    </section>
  )
}

interface ScreenProps extends StationMonitorProps {
  readonly facts: readonly string[] | null
  readonly headingId: string
  readonly logRef: ElementRef<HTMLPreElement>
  readonly onScroll: () => void
}

function MonitorScreen(props: ScreenProps) {
  const { node, label, orderId, status, alert, attachProblem, facts } = props
  return (
    <div className="fdry-crt__screen">
      <div className="fdry-crt__body">
        <div className="fdry-crt__title">
          <span>FOUNDRY LINE</span>
          <span>{orderId}</span>
        </div>
        <h3 id={props.headingId} className="fdry-crt__heading">
          {label.toUpperCase()}
        </h3>
        <div className="fdry-crt__meta">
          {metaLine(node, { status, automatic: facts !== null })}
        </div>
        {alert === null ? null : <div className="fdry-crt__alert">{alert}</div>}
        {attachProblem === null ? null : (
          <div className="fdry-crt__alert fdry-problem">{attachProblem}</div>
        )}
        <div className="fdry-crt__rule" aria-hidden="true">
          {'-'.repeat(80)}
        </div>
        {facts !== null ? <DecidedLog facts={facts} /> : <TranscriptLog {...props} />}
      </div>
    </div>
  )
}

function DecidedLog({ facts }: { readonly facts: readonly string[] }) {
  return (
    <>
      <div className="fdry-crt__auto">Automatic step · no agent</div>
      <pre className="fdry-crt__log" role="log" aria-label="What this step decided">
        {facts.length === 0 ? 'Nothing decided yet.' : facts.join('\n')}
      </pre>
    </>
  )
}

function TranscriptLog({ lines, status, logRef, onScroll }: ScreenProps) {
  return (
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
      <LogTail status={status} />
    </pre>
  )
}

/** NO CARRIER under a station nothing is running; the cursor under one that is working. */
function LogTail({ status }: { readonly status: MonitorStatus }) {
  if (status === 'gone') {
    return (
      <>
        {'\n'}
        <span className="nocarrier">NO CARRIER</span>
      </>
    )
  }
  if (status !== 'running') return null
  return (
    <>
      {'\n'}
      <span className="fdry-crt__cursor" />
    </>
  )
}

function AttachKey({ attachable, onAttach }: Pick<ChinProps, 'attachable' | 'onAttach'>) {
  return (
    <button type="button" className="fdry-crt__key" disabled={!attachable} onClick={onAttach}>
      <Terminal aria-hidden="true" />
      {attachable ? 'ATTACH' : 'AGENT CLOSED'}
    </button>
  )
}

interface ChinProps extends StationMonitorProps {
  readonly automatic: boolean
  readonly onPower: () => void
}

function MonitorChin({
  sign,
  label,
  status,
  automatic,
  attachable = true,
  onAttach,
  onPower,
}: ChinProps) {
  return (
    <div className="fdry-crt__chin">
      <span className="fdry-crt__badge">{(sign ?? label).toUpperCase()}</span>
      <span className="fdry-crt__spacer" />
      <span className="fdry-crt__led" role="img" aria-label={LED_LABEL[status]} />
      {automatic ? null : <AttachKey attachable={attachable} onAttach={onAttach} />}
      <button
        type="button"
        className="fdry-crt__power"
        aria-label="Close monitor"
        onClick={onPower}
      >
        <Power aria-hidden="true" />
      </button>
    </div>
  )
}
