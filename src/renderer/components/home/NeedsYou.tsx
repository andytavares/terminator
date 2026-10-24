import React from 'react'
import { MessageCircleQuestion, CircleCheck } from 'lucide-react'
import { AskRow, KeyHints } from './YourMove'
import type { AskHandlers, DeskCursor } from './use-desk-controller'
import type { DeskState } from './useDeskModel'
import './YourMove.css'

export interface NeedsYouProps {
  desk: Pick<DeskState, 'asks' | 'now' | 'counts'>
  cursor: DeskCursor
  handlers: AskHandlers
}

/** The asked-about row is the open one: it shows its answers, and the others stay one line. */
function openCursor(desk: NeedsYouProps['desk'], cursor: DeskCursor): DeskCursor {
  const selected = desk.asks.find((ask) => ask.id === cursor.selectedId)
  const opened = selected?.kind === 'answer' ? selected.id : null
  return { ...cursor, expandedId: cursor.expandedId ?? opened }
}

/** One dashed line when nothing asks: status by exception. */
function NothingNeedsYou({ running }: { running: number }): JSX.Element {
  return (
    <div className="quiet">
      <CircleCheck aria-hidden="true" className="quiet__icon" />
      <span>
        <b>Nothing needs you.</b>{' '}
        {running > 0 && `${running} ${running === 1 ? 'agent is' : 'agents are'} running.`}
      </span>
    </div>
  )
}

/** Everything waiting on the operator, across every task, reported asks before guessed ones. */
export function NeedsYou({ desk, cursor, handlers }: NeedsYouProps): JSX.Element {
  if (desk.asks.length === 0) return <NothingNeedsYou running={desk.counts.agentsWorking} />
  const shown = openCursor(desk, cursor)
  return (
    <section className="move" aria-label="Needs you">
      <header className="move__header">
        <MessageCircleQuestion aria-hidden="true" className="move__header-icon" />
        <h2 className="move__title">Needs you · {desk.asks.length}</h2>
        <KeyHints expanded={shown.expandedId !== null} />
      </header>
      <ul className="move__list">
        {desk.asks.map((ask) => (
          <AskRow key={ask.id} ask={ask} now={desk.now} cursor={shown} handlers={handlers} glyphs />
        ))}
      </ul>
    </section>
  )
}
