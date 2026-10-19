import React from 'react'
import {
  CircleCheck,
  CircleX,
  Eye,
  Flag,
  ListTodo,
  MessageCircleQuestion,
  type LucideIcon,
} from 'lucide-react'
import { Button, Kbd } from '@terminator/extension-ui'
import { AnswerInPlace } from './AnswerInPlace'
import { SnoozeMenu } from './SnoozeMenu'
import { untilLabel } from './desk-actions'
import type { AskHandlers, DeskCursor } from './use-desk-controller'
import type { DeskState } from './useDeskAsks'
import { ageLabel, isHot } from '../../home/desk-order'
import type { DeskAsk } from '../../home/core-asks'
import type { HomeAsk, WorkKey } from '../../../shared/schemas/home-feed.schema'
import './YourMove.css'

const KIND_ICONS: Record<HomeAsk['kind'], LucideIcon> = {
  answer: MessageCircleQuestion,
  fix: CircleX,
  review: Eye,
  decide: Flag,
  finished: CircleCheck,
  task: ListTodo,
}

export interface YourMoveProps {
  desk: Pick<DeskState, 'asks' | 'snoozed' | 'doneToday' | 'now'>
  cursor: DeskCursor
  handlers: AskHandlers
}

/** The work an extension's ask is about, as the ticket key or the branch. */
function workLabel(workKey: WorkKey | null): string {
  if (workKey === null) return ''
  return 'tracker' in workKey ? workKey.key : workKey.branch
}

/** Everything waiting on the operator, one row each, with its main action inline. */
export function YourMove(props: YourMoveProps): JSX.Element | null {
  const { desk, cursor, handlers } = props
  if (desk.asks.length === 0) return null
  return (
    <section className="move" aria-label="Your move">
      <header className="move__header">
        <MessageCircleQuestion aria-hidden="true" className="move__header-icon" />
        <h2 className="move__title">Your move · {desk.asks.length}</h2>
        <KeyHints expanded={cursor.expandedId !== null} />
      </header>
      <ul className="move__list">
        {desk.asks.map((ask) => (
          <AskRow key={ask.id} ask={ask} now={desk.now} cursor={cursor} handlers={handlers} />
        ))}
      </ul>
      <MoveFooter snoozed={desk.snoozed} doneToday={desk.doneToday} />
    </section>
  )
}

function KeyHints({ expanded }: { expanded: boolean }): JSX.Element {
  if (expanded) {
    return (
      <span className="move__hint">
        <Kbd>1</Kbd>–<Kbd>9</Kbd> answer <Kbd>R</Kbd> reply <Kbd>T</Kbd> open terminal{' '}
        <Kbd>Esc</Kbd> close
      </span>
    )
  }
  return (
    <span className="move__hint">
      <Kbd>J</Kbd>
      <Kbd>K</Kbd> move <Kbd>↵</Kbd> open <Kbd>E</Kbd> done <Kbd>H</Kbd> snooze
    </span>
  )
}

function MoveFooter({ snoozed, doneToday }: Pick<DeskState, 'snoozed' | 'doneToday'>) {
  if (snoozed.count === 0 && doneToday === 0) return null
  return (
    <footer className="move__more">
      {snoozed.until !== null && (
        <span>
          {snoozed.count} snoozed until {untilLabel(snoozed.until)}
        </span>
      )}
      <span>Done today: {doneToday}</span>
    </footer>
  )
}

interface AskRowProps {
  ask: DeskAsk
  now: number
  cursor: DeskCursor
  handlers: AskHandlers
}

function AskRow(props: AskRowProps): JSX.Element {
  const { ask, now, cursor, handlers } = props
  const expanded = cursor.expandedId === ask.id
  // A click on a button inside the row is that button's, not the row's.
  const onRowClick = (event: React.MouseEvent): void => {
    handlers.select(ask.id)
    if (!(event.target as Element).closest('button')) handlers.activate(ask)
  }
  return (
    <li className="move__item">
      <div
        className="mi"
        data-expanded={expanded || undefined}
        aria-current={cursor.selectedId === ask.id || undefined}
        onClick={onRowClick}
      >
        <AskSummary ask={ask} />
        {!expanded && <AskRowActions ask={ask} handlers={handlers} />}
        <span className="mi__age" data-hot={isHot(ask, now) || undefined}>
          {ageLabel(ask.since, now)}
        </span>
      </div>
      <AskExtras {...props} />
    </li>
  )
}

/** What opens under the row: the answer in place, and the snooze menu. */
function AskExtras(props: AskRowProps): JSX.Element {
  const { ask, now, cursor, handlers } = props
  return (
    <>
      {cursor.expandedId === ask.id && (
        <AnswerInPlace ask={ask} cursor={cursor} handlers={handlers} />
      )}
      {cursor.snoozingId === ask.id && (
        <SnoozeMenu
          now={now}
          onPick={(until) => handlers.snooze(ask, until)}
          onClose={handlers.closeSnoozeMenu}
        />
      )}
    </>
  )
}

/** The kind's icon, where the ask comes from, and what it says. */
function AskSummary({ ask }: { ask: DeskAsk }): JSX.Element {
  const Icon = KIND_ICONS[ask.kind]
  return (
    <>
      <span className={`mi__icon mi__icon--${ask.kind}`}>
        <Icon aria-hidden="true" />
      </span>
      <span className="mi__where">
        <b>{ask.title}</b>
        <small>{ask.where ?? workLabel(ask.workKey)}</small>
      </span>
      <span className="mi__what">
        {ask.detail} {ask.facts.length > 0 && <em>{ask.facts.join(' · ')}</em>}
      </span>
    </>
  )
}

const CHOICE_ACTION = /^choice-(\d+)$/

function AskRowActions({ ask, handlers }: Pick<AskRowProps, 'ask' | 'handlers'>): JSX.Element {
  return (
    <span className="mi__actions">
      {ask.actions.map((action) => {
        const choice = CHOICE_ACTION.exec(action.id)
        const quiet = !choice && !action.primary
        return (
          <Button
            key={action.id}
            size="sm"
            variant={quiet ? 'ghost' : 'secondary'}
            onClick={() => handlers.act(ask, action.id)}
          >
            {choice && <Kbd>{choice[1]}</Kbd>}
            {action.label}
            {action.id === 'reply' && !action.primary ? '…' : ''}
          </Button>
        )
      })}
    </span>
  )
}
