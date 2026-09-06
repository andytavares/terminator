import React, { useCallback, useEffect, useState } from 'react'
import { Check, X, CircleDot, Terminal, Play, Wand } from 'lucide-react'
import type { WorkOrder } from '../order/schema.js'
import type { CompileResult, CheckId } from '../order/compile.js'
import { coverageMatrix } from '../order/coverage-matrix.js'
import { surfacedQuestions } from '../forge/interview.js'
import { liveAssumptions } from '../forge/assumptions.js'
import type { StateMapping, TransitionIntent } from '../order/schema.js'
import type { CapabilityReport } from '../trackers/write-back.js'

// The Forge.
//
// The document is the subject and the conversation is behind it. The operator's
// whole job on this screen is in the left rail: six checks, and at most three
// questions. Everything else the Forge decided is a strikeable assumption
// rather than something they were asked about.

export interface OrderView {
  order: WorkOrder
  compile: CompileResult
  changed?: string[]
  unavailableChecks?: string[]
  /** The session the architect is drafting in, while it is drafting. */
  converging?: string
}

/** How often the document is refetched while the architect is working. */
const REDRAFT_POLL_MS = 3000

interface StatesView {
  capability?: CapabilityReport
  mapping?: StateMapping
  error?: string
}

/** One shape of work this order could take, and why not where it cannot. */
interface RecipeOption {
  name: string
  available: boolean
  unmet: string[]
  rung: string | null
  description?: string
}

interface RecipesView {
  recipes?: RecipeOption[]
  proposed?: string
  error?: string
}

const INTENTS: readonly TransitionIntent[] = ['started', 'in_review', 'done']

/** What each intent means in plain terms — the tracker's words are its own. */
const INTENT_LABELS: Record<TransitionIntent, string> = {
  started: 'When work starts',
  in_review: 'When the draft opens',
  done: 'When it merges',
}

const CHECK_LABELS: Record<CheckId, string> = {
  questions: 'No open questions',
  verifiable: 'Criteria falsifiable',
  coverage: 'Coverage both ways',
  risk: 'Risk graded',
  redTeam: 'Red team resolved',
  budgets: 'Budgets set',
}

const CHECK_ORDER: CheckId[] = ['questions', 'verifiable', 'coverage', 'risk', 'redTeam', 'budgets']

function invoke(channel: string, payload: unknown): Promise<unknown> {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

export interface ForgeProps {
  readonly orderId: string
  /** Take me to the agent's live session. The backstop, from any surface. */
  readonly onAttach?: (orderId: string) => void
  /** The run has begun; the caller swaps this surface for the Floor. */
  readonly onStarted?: (orderId: string) => void
}

export function Forge({ orderId, onAttach, onStarted }: ForgeProps): JSX.Element {
  const [view, setView] = useState<OrderView | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [states, setStates] = useState<StatesView | null>(null)
  /** What the last turn moved, so the operator can see the redraw (FR-007). */
  const [moved, setMoved] = useState<string[]>([])
  const [accepting, setAccepting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [recipes, setRecipes] = useState<RecipesView | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const next = (await invoke('foundry:order.compile', { id: orderId, commit: false })) as
      | OrderView
      | { error: string }
    if ('error' in next) return
    setView(next)
  }, [orderId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Read once, not on every redraw: this is a request to the tracker, and
  // polling it would spend the operator's rate limit on a panel that does not
  // change.
  useEffect(() => {
    let live = true
    void (async () => {
      const next = (await invoke('foundry:order.states', { id: orderId })) as StatesView
      if (live) setStates(next)
    })()
    return () => {
      live = false
    }
  }, [orderId])

  // Read once, alongside the document. What shapes of work this repository can
  // actually support is a fact about the repository, not about the draft.
  useEffect(() => {
    let live = true
    void (async () => {
      const next = (await invoke('foundry:run.recipes', { id: orderId })) as RecipesView
      if (live) setRecipes(next)
    })()
    return () => {
      live = false
    }
  }, [orderId])

  const mapIntent = useCallback(
    async (intent: TransitionIntent, optionId: string | null) => {
      const next = (await invoke('foundry:order.mapState', { id: orderId, intent, optionId })) as {
        mapping?: StateMapping
      }
      if (next.mapping !== undefined) {
        setStates((current) => (current === null ? current : { ...current, mapping: next.mapping }))
      }
    },
    [orderId]
  )

  const turn = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true)
      setProblem(null)
      try {
        const next = (await invoke('foundry:order.turn', { id: orderId, ...payload })) as
          | (OrderView & { error?: string })
          | { error: string }
        // A turn can both move the document and report a problem — intake that
        // refused a proposal returns the order as it stands *and* why.
        if ('order' in next) {
          setView(next)
          setMoved(next.changed ?? [])
        }
        if (next.error !== undefined) setProblem(next.error)
      } finally {
        setBusy(false)
      }
    },
    [orderId]
  )

  /** Ask the architect for a draft, or a redraft. */
  const converge = useCallback(
    async (message?: string) => {
      setBusy(true)
      setProblem(null)
      try {
        const next = (await invoke('foundry:order.converge', {
          id: orderId,
          ...(message === undefined ? {} : { message }),
        })) as (OrderView & { error?: string }) | { error: string }
        if ('order' in next) setView(next)
        if (next.error !== undefined) setProblem(next.error)
      } finally {
        setBusy(false)
      }
    },
    [orderId]
  )

  // The architect answers in minutes, not in the call that started it — so the
  // document is refetched while it works, and the redraft appears when it
  // lands rather than the surface spinning on a promise.
  useEffect(() => {
    if (view?.converging === undefined) return
    const timer = setInterval(() => void refresh(), REDRAFT_POLL_MS)
    return () => clearInterval(timer)
  }, [view?.converging, refresh])

  /**
   * Compile, agree, and start the Line.
   *
   * One action, because "handed off" that leaves the order sitting agreed with
   * nothing running is the failure this button exists to avoid — the operator
   * pressed hand off, and work has to start.
   *
   * The run is started separately from the agreement rather than inside it:
   * agreeing is a decision and is recorded; starting can fail on a recipe this
   * repository cannot support, and that must not un-agree what was agreed.
   */
  const handOff = useCallback(async () => {
    setBusy(true)
    setProblem(null)
    try {
      const next = (await invoke('foundry:order.compile', { id: orderId, commit: true })) as
        | OrderView
        | { error: string }
      if ('error' in next) {
        setProblem(next.error)
        return
      }
      setView(next)
      if (next.order.status !== 'agreed') return

      const started = (await invoke('foundry:run.start', {
        id: orderId,
        // Only when the operator picked one. Absent means the proposal
        // stands, and the ledger records which of the two it was.
        ...(chosen === null ? {} : { recipe: chosen }),
      })) as {
        error?: string
        order?: { status: string }
      }
      if (started.error !== undefined) {
        setProblem(`The order is agreed, but the run did not start: ${started.error}`)
        return
      }
      onStarted?.(orderId)
    } finally {
      setBusy(false)
    }
  }, [orderId, onStarted, chosen])

  if (view === null) {
    return <div className="fdry-empty">Loading the order…</div>
  }

  const { order, compile } = view
  const failed = new Set(compile.failures.map((f) => f.check))
  const matrix = coverageMatrix(order)
  const questions = surfacedQuestions(order.openQuestions)
  const assumptions = liveAssumptions(order)
  const openFindings = order.redTeam.filter((f) => f.status === 'open')

  return (
    <div className="fdry-forge">
      <aside className="fdry-rail">
        <section className="fdry-panel">
          <h2 className="fdry-panel-h">Convergence</h2>
          {CHECK_ORDER.map((id) => {
            const bad = failed.has(id)
            const failure = compile.failures.find((f) => f.check === id)
            return (
              <div key={id} className={`fdry-check ${bad ? 'is-fail' : 'is-pass'}`}>
                <span className="fdry-check-mark" aria-hidden="true">
                  {bad ? <X /> : <Check />}
                </span>
                <span>
                  <b>{CHECK_LABELS[id]}</b>
                  {bad && failure !== undefined ? <small>{failure.detail}</small> : null}
                </span>
              </div>
            )
          })}
          {/* The plan does not write itself. Until the architect has run, the
              six checks below are a list of everything that is missing — so
              this is the action, and hand-off is the one after it. */}
          {order.status === 'draft' ? (
            <button
              type="button"
              className="fdry-converge"
              disabled={busy || view.converging !== undefined}
              onClick={() => void converge()}
            >
              <Wand aria-hidden="true" />
              {view.converging !== undefined
                ? 'The architect is working…'
                : order.acceptance.length === 0
                  ? 'Draft the plan'
                  : 'Redraft'}
            </button>
          ) : null}
          <button
            type="button"
            className="fdry-compile"
            disabled={!compile.ok || busy || order.status !== 'draft'}
            onClick={() => void handOff()}
          >
            <Play aria-hidden="true" />
            {order.status !== 'draft'
              ? `Handed off — ${order.status}`
              : compile.ok
                ? 'Compile & hand off'
                : `Blocked by ${compile.failures.length}`}
          </button>
          {problem !== null ? <p className="fdry-problem">{problem}</p> : null}
        </section>

        {/* The shape of work. Proposed rather than chosen — a proposal nobody
            can predict is worse than a plain one — and overridden in one
            click, with the override recorded. */}
        {(recipes?.recipes?.length ?? 0) > 0 && order.status === 'draft' ? (
          <section className="fdry-panel">
            <h2 className="fdry-panel-h">Shape of work</h2>
            {recipes?.recipes?.map((option) => {
              const isChosen = (chosen ?? recipes.proposed) === option.name
              return (
                <button
                  key={option.name}
                  type="button"
                  className={`fdry-recipe ${isChosen ? 'is-on' : ''}`}
                  disabled={!option.available || busy}
                  title={option.available ? option.description : option.unmet.join('; ')}
                  onClick={() => setChosen(option.name)}
                >
                  <b>{option.name}</b>
                  <small>
                    {option.available
                      ? (option.description ?? `from ${option.rung ?? 'built-in'}`)
                      : option.unmet.join('; ')}
                  </small>
                  {option.name === recipes.proposed && chosen === null ? (
                    <span className="fdry-recipe-mark">proposed</span>
                  ) : null}
                </button>
              )
            })}
          </section>
        ) : null}

        {questions.length > 0 ? (
          <section className="fdry-panel">
            <h2 className="fdry-panel-h">Needs you — {questions.length}</h2>
            {questions.map((question) => (
              <div key={question.id} className="fdry-question">
                <b>{question.text}</b>
                {question.why !== '' ? <p>{question.why}</p> : null}
                <div className="fdry-options">
                  {question.options.map((option, index) => (
                    <button
                      key={option}
                      type="button"
                      className={index === question.recommended ? 'is-recommended' : ''}
                      disabled={busy}
                      onClick={() =>
                        void turn({ answer: { questionId: question.id, option: index } })
                      }
                    >
                      {option}
                      {index === question.recommended ? ' (recommended)' : ''}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {states?.capability !== undefined && states.capability.transitions !== 'no_issue' ? (
          <section className="fdry-panel">
            <h2 className="fdry-panel-h">Tracker write-back</h2>
            {states.capability.transitions === 'unsupported' ? (
              <p className="fdry-note">
                {order.source.tracker} cannot be asked to move an issue, so {order.source.key} will
                not change state. The summary comment and the pull request links still go across.
              </p>
            ) : (
              <>
                <p className="fdry-note">
                  Which of {order.source.tracker}&rsquo;s own states each moment means. Left alone,
                  the tracker resolves it.
                </p>
                {INTENTS.map((intent) => (
                  <label key={intent} className="fdry-map">
                    <span>{INTENT_LABELS[intent]}</span>
                    <select
                      value={states.mapping?.[intent] ?? ''}
                      onChange={(event) =>
                        void mapIntent(
                          intent,
                          event.target.value === '' ? null : event.target.value
                        )
                      }
                    >
                      <option value="">
                        {states.capability?.unreachable.includes(intent) === true
                          ? 'nowhere to go — skipped'
                          : 'let the tracker decide'}
                      </option>
                      {states.capability?.states.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </>
            )}
          </section>
        ) : null}

        {view.unavailableChecks !== undefined && view.unavailableChecks.length > 0 ? (
          <section className="fdry-panel">
            <h2 className="fdry-panel-h">Not measurable here</h2>
            <p className="fdry-note">
              This repository has no command for {view.unavailableChecks.join(', ')}. Those checks
              will report &ldquo;not measured&rdquo; rather than passing.
            </p>
          </section>
        ) : null}
      </aside>

      <main className="fdry-doc">
        <header className="fdry-doc-head">
          <h1>{order.title}</h1>
          {order.source.key !== null ? (
            <span className="fdry-src">
              {order.source.tracker} {order.source.key}
            </span>
          ) : null}
          <span className="fdry-id">{order.id}</span>
          {onAttach !== undefined ? (
            <button type="button" className="fdry-attach" onClick={() => onAttach(order.id)}>
              <Terminal aria-hidden="true" /> Attach
            </button>
          ) : null}
        </header>
        <p className="fdry-doc-sub">
          recipe <b>{order.recipe ?? 'not chosen'}</b> · risk {order.risk.grade} ·{' '}
          {order.plan.units.length} units · {order.status}
        </p>

        <section className={`fdry-field ${moved.includes('intent') ? 'is-redrawn' : ''}`}>
          <h2 className="fdry-panel-h">Intent</h2>
          <p>
            <b>Problem.</b> {order.intent.problem || 'not stated yet'}
          </p>
          <p>
            <b>Outcome.</b> {order.intent.outcome || 'not stated yet'}
          </p>
        </section>

        <section className={`fdry-field ${moved.includes('acceptance') ? 'is-redrawn' : ''}`}>
          <h2 className="fdry-panel-h">Acceptance &amp; how it is proven</h2>
          {order.acceptance.length === 0 ? (
            <p className="fdry-note">
              No criteria yet. Nothing writes them but the architect — press &ldquo;Draft the
              plan&rdquo;.
            </p>
          ) : (
            order.acceptance.map((criterion) => {
              const uncovered = matrix.uncoveredCriteria.includes(criterion.id)
              return (
                <div key={criterion.id} className={`fdry-ac ${uncovered ? 'is-gap' : ''}`}>
                  <span className="fdry-ac-id">{criterion.id}</span>
                  <div>
                    <p>{criterion.statement}</p>
                    <span className="fdry-verify">
                      {criterion.verify.kind}
                      {uncovered ? ' · no unit satisfies this' : ''}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </section>

        {matrix.criteria.length > 0 && matrix.units.length > 0 ? (
          <section className="fdry-field">
            <h2 className="fdry-panel-h">Coverage</h2>
            <div className="fdry-scroll">
              <table className="fdry-matrix">
                <thead>
                  <tr>
                    <th aria-label="criterion" />
                    {matrix.units.map((unit) => (
                      <th key={unit}>{unit}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.criteria.map((criterion, row) => (
                    <tr key={criterion}>
                      <td className="fdry-matrix-row">{criterion}</td>
                      {matrix.cells[row].map((hit, column) => (
                        <td
                          key={matrix.units[column]}
                          className={
                            hit
                              ? 'is-hit'
                              : matrix.uncoveredCriteria.includes(criterion)
                                ? 'is-gap'
                                : ''
                          }
                        >
                          {hit ? '●' : '·'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {assumptions.length > 0 ? (
          <section className={`fdry-field ${moved.includes('assumptions') ? 'is-redrawn' : ''}`}>
            <h2 className="fdry-panel-h">Assumptions — strike any that are wrong</h2>
            <div className="fdry-assume">
              {assumptions.map((assumption) => (
                <button
                  key={assumption.id}
                  type="button"
                  disabled={busy}
                  onClick={() => void turn({ strike: assumption.id })}
                >
                  {assumption.text} <X aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {/* Every one of these has to be cleared before the order can be handed
            off. Showing them without a way to clear them is what blocked the
            gate for ever. */}
        {openFindings.length > 0 ? (
          <section className={`fdry-field ${moved.includes('redTeam') ? 'is-redrawn' : ''}`}>
            <h2 className="fdry-panel-h">Red team — {openFindings.length} open</h2>
            {openFindings.map((finding) => (
              <div key={finding.id} className="fdry-finding">
                <CircleDot aria-hidden="true" />
                <span>{finding.text}</span>
                <span className="fdry-finding-actions">
                  <button
                    type="button"
                    disabled={busy}
                    title="It is fixed"
                    onClick={() => void turn({ finding: { id: finding.id, decision: 'resolved' } })}
                  >
                    Fixed
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    title="It stands, and here is why"
                    onClick={() => setAccepting(finding.id)}
                  >
                    Accept
                  </button>
                </span>
              </div>
            ))}
            {accepting !== null ? (
              <form
                className="fdry-accept"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (reason.trim() === '') return
                  void turn({
                    finding: { id: accepting, decision: 'accepted', reason: reason.trim() },
                  })
                  setAccepting(null)
                  setReason('')
                }}
              >
                <input
                  aria-label="Why this finding is accepted"
                  placeholder="Why it stands…"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
                <button type="submit" disabled={reason.trim() === ''}>
                  Accept it
                </button>
              </form>
            ) : null}
          </section>
        ) : null}

        <form
          className="fdry-input"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim() === '') return
            // Straight to the architect. `turn` routes free text there too;
            // going directly says what the button does.
            void converge(draft)
            setDraft('')
          }}
        >
          <input
            aria-label="Tell the architect what is wrong, or what you want instead"
            placeholder="Tell the architect what's wrong, or what you want instead…"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={busy || draft.trim() === ''}>
            Send
          </button>
        </form>
      </main>
    </div>
  )
}
