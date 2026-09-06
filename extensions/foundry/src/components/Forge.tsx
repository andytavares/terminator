import React, { useCallback, useEffect, useState } from 'react'
import { Check, X, CircleDot, Terminal, Play } from 'lucide-react'
import type { WorkOrder } from '../order/schema.js'
import type { CompileResult, CheckId } from '../order/compile.js'
import { coverageMatrix } from '../order/coverage-matrix.js'
import { surfacedQuestions } from '../forge/interview.js'
import { liveAssumptions } from '../forge/assumptions.js'

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
}

export function Forge({ orderId, onAttach }: ForgeProps): JSX.Element {
  const [view, setView] = useState<OrderView | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')

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

  const turn = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true)
      try {
        const next = (await invoke('foundry:order.turn', { id: orderId, ...payload })) as
          | OrderView
          | { error: string }
        if (!('error' in next)) setView(next)
      } finally {
        setBusy(false)
      }
    },
    [orderId]
  )

  const handOff = useCallback(async () => {
    setBusy(true)
    try {
      const next = (await invoke('foundry:order.compile', { id: orderId, commit: true })) as
        | OrderView
        | { error: string }
      if (!('error' in next)) setView(next)
    } finally {
      setBusy(false)
    }
  }, [orderId])

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
        </section>

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

        <section className="fdry-field">
          <h2 className="fdry-panel-h">Intent</h2>
          <p>
            <b>Problem.</b> {order.intent.problem || 'not stated yet'}
          </p>
          <p>
            <b>Outcome.</b> {order.intent.outcome || 'not stated yet'}
          </p>
        </section>

        <section className="fdry-field">
          <h2 className="fdry-panel-h">Acceptance &amp; how it is proven</h2>
          {order.acceptance.length === 0 ? (
            <p className="fdry-note">No criteria yet.</p>
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
          <section className="fdry-field">
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

        {openFindings.length > 0 ? (
          <section className="fdry-field">
            <h2 className="fdry-panel-h">Red team — {openFindings.length} open</h2>
            {openFindings.map((finding) => (
              <div key={finding.id} className="fdry-finding">
                <CircleDot aria-hidden="true" />
                <span>{finding.text}</span>
              </div>
            ))}
          </section>
        ) : null}

        <form
          className="fdry-input"
          onSubmit={(event) => {
            event.preventDefault()
            if (draft.trim() === '') return
            void turn({ message: draft })
            setDraft('')
          }}
        >
          <input
            aria-label="Answer, strike an assumption, or say what is wrong"
            placeholder="Answer, strike an assumption, or say what's wrong…"
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
