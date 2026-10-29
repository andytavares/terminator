import React, { useMemo, useState } from 'react'
import { Clock, SquareTerminal } from 'lucide-react'
import { Button, Kbd } from '@terminator/extension-ui'
import { terminalExcerpt } from './desk-actions'
import { recordUse } from '../../usage/record'
import type { AskHandlers, DeskCursor } from './use-desk-controller'
import type { DeskAsk } from '../../home/core-asks'

export interface AnswerInPlaceProps {
  ask: DeskAsk
  cursor: DeskCursor
  handlers: AskHandlers
}

/** The agent's last screen as text, its numbered answers and a reply box, inside the band. */
export function AnswerInPlace(props: AnswerInPlaceProps): JSX.Element {
  const { ask, cursor, handlers } = props
  const excerpt = useMemo(() => terminalExcerpt(ask.sessionId), [ask.sessionId])
  return (
    <div className="answer">
      <pre className="answer__term" aria-label="Terminal excerpt">
        {excerpt.length > 0 ? excerpt.join('\n') : 'The terminal has nothing to show.'}
      </pre>
      <div className="answer__side">
        <div className="answer__label">Answer</div>
        <ChoiceList ask={ask} handlers={handlers} />
        <ReplyField
          replying={cursor.replying}
          onSend={(text) => {
            recordUse('core.home.answer')
            handlers.replyToAsk(ask, text)
          }}
        />
        <GhostActions ask={ask} handlers={handlers} />
      </div>
    </div>
  )
}

function ChoiceList(props: Pick<AnswerInPlaceProps, 'ask' | 'handlers'>): JSX.Element {
  const { ask, handlers } = props
  return (
    <>
      {(ask.choices ?? []).map((choice) => (
        <Button
          key={choice.number}
          onClick={() => {
            recordUse('core.home.answer')
            handlers.act(ask, `choice-${choice.number}`)
          }}
        >
          <Kbd>{choice.number}</Kbd>
          {choice.label}
        </Button>
      ))}
    </>
  )
}

function GhostActions(props: Pick<AnswerInPlaceProps, 'ask' | 'handlers'>): JSX.Element {
  const { ask, handlers } = props
  return (
    <div className="answer__more">
      <Button
        size="sm"
        variant="ghost"
        icon={SquareTerminal}
        onClick={() => handlers.openTerminal(ask)}
      >
        Open terminal
      </Button>
      <Button size="sm" variant="ghost" icon={Clock} onClick={() => handlers.openSnoozeMenu(ask)}>
        Snooze
      </Button>
    </div>
  )
}

function ReplyField(props: { replying: boolean; onSend: (text: string) => void }): JSX.Element {
  const [text, setText] = useState('')
  return (
    <label className="desk-field">
      <input
        type="text"
        aria-label="Reply in your own words"
        placeholder="Reply in your own words…"
        autoFocus={props.replying}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && text.trim() !== '') props.onSend(text)
        }}
      />
      <Kbd>R</Kbd>
    </label>
  )
}
