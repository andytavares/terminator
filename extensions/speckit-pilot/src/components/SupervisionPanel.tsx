import React, { useCallback, useEffect, useState } from 'react'
import {
  getSpeckitAPI,
  type DigestView,
  type FeedEntryView,
  type ReviewItemView,
  type RunView,
  type StallFiringView,
  type HunkFileView,
  type IntentReviewView,
  type ReviewStepView,
  type UnattendedMergeView,
  type SupervisionSnapshot,
  type TranscriptLineView,
} from '../types/electron.js'

// Everything the supervision layer knows, on screen.
//
// The layer was complete and unreachable: nine channels with working backends
// and nothing rendering them, which is the same "correct and invisible" shape
// this whole line of work exists to stop shipping.
//
// Four sections, in the order you would ask: what is running, what has stopped
// making progress, what is waiting to be reviewed, and what happened while you
// were away.

export interface SupervisionPanelProps {
  /** Names a card, since a run belongs to one. */
  cardLabel?: (featureDir: string) => string
  /** Takes the operator to a run's terminal. Navigation is the host's job. */
  onOpenTerminal?: (terminalSessionId: string) => void
  /** The repository a discard removes the worktree and branch from. */
  workspacePath?: string
  /** Something changed that the rest of the board should reload. */
  onChanged?: () => void
  /**
   * Show this run, or this queued diff, now.
   *
   * The palette hands the panel a session and expects the section it lives in
   * to be the one on screen; without this the jump lands on whatever tab was
   * open and reads as having done nothing.
   */
  focus?: { kind: 'run' | 'review'; sessionId: string } | null
}

const STATE_LABEL: Record<RunView['state'], string> = {
  working: 'working',
  waiting: 'waiting on you',
  stalled: 'not making progress',
  ready: 'ready to review',
  finished: 'finished',
}

/** Elapsed time in the unit a person would say it in. */
export function elapsed(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

/**
 * The four things you do about a run that has stopped: read it, redirect it,
 * end it, or throw it away.
 *
 * Offered on every run rather than only on a stalled one — the moment you most
 * want to redirect an agent is usually before anything has declared it stuck.
 */
function RunActions({
  sessionId,
  label,
  workspacePath,
  onOpenTerminal,
  onChanged,
}: {
  sessionId: string
  /** Names the run in the redirect field's label, for a screen reader. */
  label: string
  workspacePath?: string
  onOpenTerminal?: (terminalSessionId: string) => void
  onChanged: () => void
}): JSX.Element {
  const [redirecting, setRedirecting] = useState(false)
  const [message, setMessage] = useState('')
  const [transcript, setTranscript] = useState<TranscriptLineView[] | null>(null)

  const toggleTranscript = useCallback(async () => {
    if (transcript !== null) {
      setTranscript(null)
      return
    }
    const { lines } = await getSpeckitAPI().runTranscript({ sessionId, limit: 20 })
    setTranscript(lines)
  }, [sessionId, transcript])

  return (
    <>
      <span className="sk-sup__actions">
        {onOpenTerminal !== undefined && (
          <button
            className="sk-sup__btn"
            // Resolved when clicked rather than carried on the row: a stall is
            // recorded with a session id and nothing else, and the terminal a
            // run is in is the runner's to answer.
            onClick={() =>
              void getSpeckitAPI()
                .runTerminal({ sessionId })
                .then(({ terminalSessionId }) => {
                  if (terminalSessionId !== null) onOpenTerminal(terminalSessionId)
                })
            }
          >
            Terminal
          </button>
        )}
        <button className="sk-sup__btn" onClick={() => void toggleTranscript()}>
          {transcript === null ? 'Transcript' : 'Hide'}
        </button>
        <button
          className="sk-sup__btn"
          title="End the current turn but keep the run, so a redirect still lands"
          onClick={() => void getSpeckitAPI().runInterrupt({ sessionId }).then(onChanged)}
        >
          Interrupt
        </button>
        <button className="sk-sup__btn" onClick={() => setRedirecting((on) => !on)}>
          Redirect
        </button>
        <button
          className="sk-sup__btn"
          onClick={() => void getSpeckitAPI().runStop({ sessionId }).then(onChanged)}
        >
          Stop
        </button>
        {workspacePath !== undefined && (
          <button
            className="sk-sup__btn"
            title="End it and remove its worktree and branch"
            onClick={() =>
              void getSpeckitAPI().runDiscard({ sessionId, workspacePath }).then(onChanged)
            }
          >
            Discard
          </button>
        )}
      </span>
      {redirecting && (
        <div className="sk-sup__redirect">
          <input
            aria-label={`Redirect ${label}`}
            placeholder="ask what is wrong, or say what to do instead"
            value={message}
            autoFocus
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              const text = message.trim()
              if (text === '') return
              void getSpeckitAPI().runRedirect({ sessionId, message: text }).then(onChanged)
              setMessage('')
              setRedirecting(false)
            }}
          />
        </div>
      )}
      {transcript !== null && (
        <div className="sk-sup__transcript">
          {transcript.length === 0 ? (
            <div className="sk-sup__meta">Nothing has been written yet.</div>
          ) : (
            transcript.map((line, index) => (
              <div className="sk-sup__line" key={`${line.at}-${index}`}>
                <span className="sk-sup__author">{line.role === 'user' ? 'you' : 'agent'}</span>
                <span className="sk-sup__said">{line.text}</span>
              </div>
            ))
          )}
        </div>
      )}
    </>
  )
}

function Runs({
  runs,
  now,
  cardLabel,
  workspacePath,
  onOpenTerminal,
  onChanged,
}: {
  runs: readonly RunView[]
  now: number
  onChanged: () => void
} & Pick<SupervisionPanelProps, 'cardLabel' | 'onOpenTerminal' | 'workspacePath'>): JSX.Element {
  if (runs.length === 0) {
    return <div className="sk-sup__clear">Nothing is running.</div>
  }

  return (
    <div className="sk-sup__list">
      {runs.map((run) => (
        <div className="sk-sup__row" key={run.sessionId}>
          <span className={`sk-sup__state sk-sup__state--${run.state}`}>
            {STATE_LABEL[run.state]}
          </span>
          <span className="sk-sup__main">
            <div className="sk-sup__title">{cardLabel?.(run.featureDir) ?? run.branch}</div>
            <div className="sk-sup__meta">
              {run.phase} · {run.branch} · {elapsed(Math.max(0, now - run.stateSince))} ·{' '}
              {run.turns} {run.turns === 1 ? 'turn' : 'turns'}
              {run.diff.files > 0 &&
                ` · ${run.diff.files} ${run.diff.files === 1 ? 'file' : 'files'} +${run.diff.added} −${run.diff.removed}`}
              {run.asked > 0 && ` · asked ${run.asked}×`}
            </div>
          </span>
          <RunActions
            sessionId={run.sessionId}
            label={run.branch}
            workspacePath={workspacePath}
            onOpenTerminal={onOpenTerminal}
            onChanged={onChanged}
          />
        </div>
      ))}
    </div>
  )
}

function Stalls({
  firings,
  shadowMode,
  now,
  cardLabel,
  workspacePath,
  onOpenTerminal,
  onChanged,
}: {
  firings: readonly StallFiringView[]
  shadowMode: boolean
  now: number
  cardLabel?: (featureDir: string) => string
  workspacePath?: string
  onOpenTerminal?: (terminalSessionId: string) => void
  onChanged: () => void
}): JSX.Element {
  return (
    <>
      <div className="sk-sup__note">
        {shadowMode
          ? 'Shadow mode: stalls are recorded here, not surfaced. Turn it off once the thresholds have earned it.'
          : 'Stalls are surfaced as they happen.'}
      </div>
      {firings.length === 0 ? (
        <div className="sk-sup__clear">Nothing has stopped making progress.</div>
      ) : (
        <div className="sk-sup__list">
          {firings.map(({ firing, featureDir }, index) => (
            <div className="sk-sup__row" key={`${firing.sessionId}-${index}`}>
              <span className="sk-sup__state sk-sup__state--stalled">{firing.signal}</span>
              <span className="sk-sup__main">
                <div className="sk-sup__title">
                  {cardLabel?.(featureDir) ?? featureDir.split('/').pop()}
                </div>
                {/* The numbers that justified it, so a firing can be judged
                    later rather than taken on trust. */}
                <div className="sk-sup__meta">
                  quiet for {elapsed(firing.inputs.toolSilenceMs)} ·{' '}
                  {firing.inputs.shellInFlight ? 'a command was running' : 'nothing was running'} ·{' '}
                  {elapsed(Math.max(0, now - firing.firedAt))} ago
                </div>
              </span>
              {/* A stall you cannot act on is a notification, not a console. */}
              <RunActions
                sessionId={firing.sessionId}
                label={featureDir.split('/').pop() ?? firing.sessionId}
                workspacePath={workspacePath}
                onOpenTerminal={onOpenTerminal}
                onChanged={onChanged}
              />
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * The step every diff viewer skips: what was asked for, against what the agent
 * says it did, against what it actually changed.
 *
 * First, deliberately. It is the step that catches work which is defensible in
 * isolation and was never asked for, and reading the diff first is how you end
 * up justifying it instead of questioning it.
 */
function IntentStep({ sessionId, request }: { sessionId: string; request: string }): JSX.Element {
  const [intent, setIntent] = useState<IntentReviewView | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // The agent's own account of what it did, in its own words — the last
      // thing it said before it stopped.
      const { lines } = await getSpeckitAPI().runTranscript({ sessionId, limit: 6 })
      const account = lines
        .filter((line) => line.role === 'assistant')
        .map((line) => line.text)
        .join('\n')
      const result = await getSpeckitAPI().reviewIntent({
        sessionId,
        request,
        agentAccount: account,
      })
      if (cancelled) return
      setIntent(result.intent)
      setChecked(true)
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, request])

  if (!checked) return <div className="sk-sup__meta">Reading what it said it did…</div>
  if (intent === null) return <></>

  const clean = intent.unexpectedFiles.length === 0 && intent.untouchedFiles.length === 0

  return (
    <div className={intent.hasScopeConcern ? 'sk-sup__warn' : 'sk-sup__note'}>
      {clean ? (
        'Everything it changed was asked for, and everything asked for was changed.'
      ) : (
        <>
          {intent.unexpectedFiles.length > 0 && (
            <div>Changed without being asked: {intent.unexpectedFiles.join(', ')}</div>
          )}
          {intent.untouchedFiles.length > 0 && (
            <div>Asked for but never touched: {intent.untouchedFiles.join(', ')}</div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * The diff, hunk by hunk.
 *
 * The unit of decision is the hunk rather than the file, because one file
 * routinely holds both the change you asked for and the one you did not, and
 * accepting a file wholesale is how the second one ships.
 */
function HunkReview({
  sessionId,
  request,
  onDone,
}: {
  sessionId: string
  /** What the card asked for, which the intent step reads the diff against. */
  request: string
  onDone: () => void
}): JSX.Element {
  const [files, setFiles] = useState<HunkFileView[]>([])
  const [complete, setComplete] = useState(false)
  const [fullReject, setFullReject] = useState(false)
  const [step, setStep] = useState<ReviewStepView | 'done'>('intent')
  const [applying, setApplying] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await getSpeckitAPI().reviewHunks({ sessionId })
    setFiles(result.files)
    setComplete(result.complete)
    setFullReject(result.fullReject ?? false)
  }, [sessionId])

  useEffect(() => {
    void load()
  }, [load])

  const decide = useCallback(
    (hunkId: string, decision: 'accept' | 'reject') =>
      void getSpeckitAPI().reviewDecideHunk({ sessionId, hunkId, decision }).then(load),
    [sessionId, load]
  )

  if (files.length === 0) {
    return <div className="sk-sup__clear">This run changed nothing that can be read as a diff.</div>
  }

  const rejectedCount = files
    .flatMap((file) => file.hunks)
    .filter((hunk) => hunk.decision === 'reject').length

  return (
    <div className="sk-sup__review">
      {/* Where this review has got to, and the step that has to come first. */}
      <div className="sk-sup__meta">
        Step: {step === 'done' ? 'every step taken' : step}
        {step !== 'done' && (
          <button
            className="sk-sup__btn"
            onClick={() =>
              void getSpeckitAPI()
                .reviewAdvance({ sessionId })
                .then(({ step: next }) => setStep(next ?? 'done'))
            }
          >
            Next step
          </button>
        )}
      </div>
      {step === 'intent' && <IntentStep sessionId={sessionId} request={request} />}
      {files.map((file) => (
        <div className="sk-sup__file" key={file.file}>
          <div className="sk-sup__filename">{file.file}</div>
          {file.hunks.map((hunk) => (
            <div
              className={`sk-sup__hunk${hunk.decision === null ? '' : ` sk-sup__hunk--${hunk.decision}`}`}
              key={hunk.id}
            >
              <pre className="sk-sup__diff">{hunk.lines.join('\n')}</pre>
              <span className="sk-sup__actions">
                <button
                  className="sk-sup__btn"
                  aria-pressed={hunk.decision === 'accept'}
                  onClick={() => decide(hunk.id, 'accept')}
                >
                  Accept
                </button>
                <button
                  className="sk-sup__btn"
                  aria-pressed={hunk.decision === 'reject'}
                  onClick={() => decide(hunk.id, 'reject')}
                >
                  Reject
                </button>
              </span>
            </div>
          ))}
        </div>
      ))}
      {/* Said rather than implied by a disabled button with no explanation. */}
      {fullReject && (
        <div className="sk-sup__warn">
          Every hunk is rejected — this branch keeps nothing, so discard the run rather than merging
          it.
        </div>
      )}
      {/* What the button is about to do, before it does it. Reverting is not
          undoable from here, and a button that quietly rewrites the working
          copy is not one you can trust twice. */}
      {failure !== null && <div className="sk-sup__warn">Nothing was reverted: {failure}</div>}
      <button
        className="sk-sup__btn"
        disabled={!complete || applying}
        onClick={() => {
          setApplying(true)
          setFailure(null)
          void getSpeckitAPI()
            .reviewApply({ sessionId })
            .then((result) => {
              setApplying(false)
              // Left open on failure: the decisions are still there to retry,
              // and closing would lose them along with the reason.
              if (!result.ok) {
                setFailure(result.error ?? 'git refused the patch')
                return
              }
              onDone()
            })
        }}
      >
        {!complete
          ? 'Decide every hunk to finish'
          : applying
            ? 'Reverting…'
            : rejectedCount === 0
              ? 'Finish review — keep everything'
              : `Finish review — revert ${rejectedCount} ${rejectedCount === 1 ? 'hunk' : 'hunks'}`}
      </button>
    </div>
  )
}

/**
 * What merged with nobody looking.
 *
 * Off by default and shown only when it has happened: an unattended merge is
 * the one action here that takes place with no person watching, so the record
 * of it belongs next to the queue it bypassed rather than in a log file.
 */
function UnattendedMerges(): JSX.Element {
  const [merges, setMerges] = useState<UnattendedMergeView[]>([])

  useEffect(() => {
    void getSpeckitAPI()
      .unattendedMerges()
      .then(({ merges: recorded }) => setMerges(recorded))
  }, [])

  if (merges.length === 0) return <></>

  return (
    <div className="sk-sup__note">
      Merged without review: {merges.length}
      {merges.map((merge) => (
        <div className="sk-sup__meta" key={`${merge.sessionId}-${merge.mergedAt}`}>
          {merge.repoPath.split('/').pop()} · {merge.gradeTrigger} · checks {merge.checkState} ·{' '}
          {merge.diffSummary.files} {merge.diffSummary.files === 1 ? 'file' : 'files'}
        </div>
      ))}
    </div>
  )
}

function Review({
  items,
  backpressure,
  cardLabel,
  openSessionId,
  onDone,
}: {
  items: readonly ReviewItemView[]
  backpressure: SupervisionSnapshot['backpressure']
  cardLabel?: (featureDir: string) => string
  /** Opened from elsewhere — the palette, today. */
  openSessionId?: string | null
  onDone: (sessionId: string) => void
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(openSessionId ?? null)
  useEffect(() => {
    if (openSessionId !== undefined && openSessionId !== null) setOpen(openSessionId)
  }, [openSessionId])
  return (
    <>
      {/* Said out loud rather than shown as a disabled button somewhere else. */}
      {!backpressure.allowed && (
        <div className="sk-sup__warn">
          {backpressure.reason ??
            `${backpressure.unreviewed} diffs are waiting — no new run will start until one is reviewed.`}
        </div>
      )}
      <UnattendedMerges />
      {items.length === 0 ? (
        <div className="sk-sup__clear">Nothing is waiting to be reviewed.</div>
      ) : (
        <div className="sk-sup__list">
          {/* Worst first, which is the order the queue is kept in. */}
          {items.map((item) => (
            <div className="sk-sup__row" key={item.sessionId}>
              <span className={`sk-sup__grade sk-sup__grade--${item.grade}`}>{item.grade}</span>
              <span className="sk-sup__main">
                <div className="sk-sup__title">{cardLabel?.(item.branch) ?? item.branch}</div>
                <div className="sk-sup__meta">
                  {/* The trigger, not just the letter — a grade with no reason
                      is a number you learn to ignore. */}
                  {item.gradeTrigger} · {item.diffSummary.files}{' '}
                  {item.diffSummary.files === 1 ? 'file' : 'files'} +{item.diffSummary.added} −
                  {item.diffSummary.removed}
                </div>
              </span>
              <span className="sk-sup__actions">
                <button
                  className="sk-sup__btn"
                  aria-expanded={open === item.sessionId}
                  onClick={() => setOpen((id) => (id === item.sessionId ? null : item.sessionId))}
                >
                  {open === item.sessionId ? 'Close' : 'Review'}
                </button>
              </span>
              {open === item.sessionId && (
                <HunkReview
                  sessionId={item.sessionId}
                  request={cardLabel?.(item.branch) ?? item.branch}
                  onDone={() => {
                    setOpen(null)
                    onDone(item.sessionId)
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

/**
 * When you last read the feed.
 *
 * Kept in the browser rather than the runtime: it is a property of the person
 * looking, not of the runs, and it must survive the extension host restarting
 * without becoming state a run has to reason about.
 */
const LAST_LOOKED_KEY = 'speckit.feed.lastLookedAt'

function readLastLooked(): number | null {
  const raw = window.localStorage.getItem(LAST_LOOKED_KEY)
  if (raw === null) return null
  const at = Number(raw)
  return Number.isFinite(at) ? at : null
}

function Feed({ entries, now }: { entries: readonly FeedEntryView[]; now: number }): JSX.Element {
  const [lastLooked] = useState(readLastLooked)
  const [digest, setDigest] = useState<DigestView | null>(null)

  // Coming back after 45 minutes away, the question is not "what happened" line
  // by line — it is "what happened that I have not seen". Marked as read on the
  // way out so the next visit answers the same question about a new interval.
  useEffect(() => {
    if (lastLooked === null) return
    void getSpeckitAPI().feedDigest({ from: lastLooked }).then(setDigest)
  }, [lastLooked])

  useEffect(() => {
    return () => window.localStorage.setItem(LAST_LOOKED_KEY, String(Date.now()))
  }, [])

  if (entries.length === 0) {
    return <div className="sk-sup__clear">Nothing has happened yet.</div>
  }
  return (
    <div className="sk-sup__list">
      {digest !== null && digest.entryCount > 0 && (
        <div className="sk-sup__note">
          Since you last looked {elapsed(Math.max(0, now - digest.from))} ago: {digest.entryCount}{' '}
          {digest.entryCount === 1 ? 'thing' : 'things'} across {digest.sessionCount}{' '}
          {digest.sessionCount === 1 ? 'run' : 'runs'}.
        </div>
      )}
      {entries.map((entry) => (
        <div className="sk-sup__row" key={entry.id}>
          {/* Attributed, because an entry the pilot wrote is not the agent
              speaking and a feed that blurs the two is one you stop trusting. */}
          <span className="sk-sup__author">{entry.author === 'console' ? 'Pilot' : 'agent'}</span>
          <span className="sk-sup__main">
            <div className="sk-sup__title">{entry.summary}</div>
            <div className="sk-sup__meta">{elapsed(Math.max(0, now - entry.at))} ago</div>
          </span>
        </div>
      ))}
    </div>
  )
}

type Section = 'runs' | 'stalls' | 'review' | 'feed'

export function SupervisionPanel({
  cardLabel,
  onOpenTerminal,
  workspacePath,
  onChanged,
  focus,
}: SupervisionPanelProps): JSX.Element {
  const [section, setSection] = useState<Section>('runs')
  const [snapshot, setSnapshot] = useState<SupervisionSnapshot>({
    runs: [],
    review: [],
    backpressure: { allowed: true, unreviewed: 0, limit: 0 },
  })
  const [stalls, setStalls] = useState<{ firings: StallFiringView[]; shadowMode: boolean }>({
    firings: [],
    shadowMode: true,
  })
  const [feed, setFeed] = useState<FeedEntryView[]>([])
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    const api = getSpeckitAPI()
    const [next, firings, entries] = await Promise.all([
      api.supervisionSnapshot(),
      api.stallsList(),
      api.feedList(),
    ])
    setSnapshot(next)
    setStalls(firings)
    setFeed(entries.entries)
  }, [])

  const reload = useCallback(() => {
    void load()
    onChanged?.()
  }, [load, onChanged])

  useEffect(() => {
    void load()
  }, [load])

  // Elapsed times are most of what this panel says, and a clock that does not
  // move makes a run look frozen when it is fine.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now())
      void load()
    }, 5_000)
    return () => clearInterval(timer)
  }, [load])

  // A jump has to land where the thing is, or it reads as having done nothing.
  useEffect(() => {
    if (focus == null) return
    setSection(focus.kind === 'review' ? 'review' : 'runs')
  }, [focus])

  const counts: Record<Section, number> = {
    runs: snapshot.runs.filter((run) => run.state !== 'finished').length,
    stalls: stalls.firings.length,
    review: snapshot.review.length,
    feed: feed.length,
  }

  return (
    <div className="sk-sup">
      <div className="sk-sup__tabs">
        {(['runs', 'stalls', 'review', 'feed'] as const).map((id) => (
          <button
            key={id}
            className={`sk-sup__tab${section === id ? ' sk-sup__tab--on' : ''}`}
            aria-selected={section === id}
            onClick={() => setSection(id)}
          >
            {id} {counts[id] > 0 && <span className="sk-sup__count">{counts[id]}</span>}
          </button>
        ))}
      </div>

      {section === 'runs' && (
        <Runs
          runs={snapshot.runs.filter((run) => run.state !== 'finished')}
          now={now}
          cardLabel={cardLabel}
          workspacePath={workspacePath}
          onOpenTerminal={onOpenTerminal}
          onChanged={reload}
        />
      )}
      {section === 'stalls' && (
        <Stalls
          firings={stalls.firings}
          shadowMode={stalls.shadowMode}
          now={now}
          cardLabel={cardLabel}
          workspacePath={workspacePath}
          onOpenTerminal={onOpenTerminal}
          onChanged={reload}
        />
      )}
      {section === 'review' && (
        <Review
          items={snapshot.review}
          backpressure={snapshot.backpressure}
          cardLabel={cardLabel}
          openSessionId={focus?.kind === 'review' ? focus.sessionId : null}
          onDone={(sessionId) => void getSpeckitAPI().reviewDone({ sessionId }).then(reload)}
        />
      )}
      {section === 'feed' && <Feed entries={feed} now={now} />}
    </div>
  )
}
