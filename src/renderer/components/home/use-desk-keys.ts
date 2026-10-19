import { useCallback, useRef } from 'react'
import type React from 'react'
import type { HomeViewName } from './home-view'

// The Desk's single-letter keys. They act only while focus is inside Home and not in a field or a
// terminal, so typing a reply or a command never moves the selection.

export type DeskKeyCommand =
  | { kind: 'move'; step: 1 | -1 }
  | { kind: 'open' | 'reply' | 'done' | 'snooze' | 'terminal' | 'escape' | 'go-to' }
  | { kind: 'choose'; number: number }
  | { kind: 'view'; view: HomeViewName }

type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>

const LETTER_COMMANDS: Record<string, DeskKeyCommand> = {
  j: { kind: 'move', step: 1 },
  k: { kind: 'move', step: -1 },
  r: { kind: 'reply' },
  e: { kind: 'done' },
  h: { kind: 'snooze' },
  t: { kind: 'terminal' },
  g: { kind: 'go-to' },
  Enter: { kind: 'open' },
  Escape: { kind: 'escape' },
}

const AFTER_G: Record<string, HomeViewName> = { i: 'insights', d: 'desk' }

/** What the key means on the Desk; `afterG` is true when the key before it was G. */
export function deskKeyCommand(press: KeyPress, afterG: boolean): DeskKeyCommand | null {
  if (press.metaKey || press.ctrlKey || press.altKey) return null
  if (afterG && AFTER_G[press.key]) return { kind: 'view', view: AFTER_G[press.key] }
  if (/^[1-9]$/.test(press.key)) return { kind: 'choose', number: Number(press.key) }
  return LETTER_COMMANDS[press.key] ?? null
}

/** A field or a terminal: keys pressed there are the operator's typing. */
function isTyping(target: EventTarget): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable], .xterm') !== null
  )
}

/** The keydown handler for Home's root: reads the key, then hands the command on. */
export function useDeskKeys(onCommand: (command: DeskKeyCommand) => void) {
  const afterG = useRef(false)
  return useCallback(
    (event: React.KeyboardEvent) => {
      if (isTyping(event.target) && event.key !== 'Escape') return
      const command = deskKeyCommand(event, afterG.current)
      afterG.current = command?.kind === 'go-to'
      if (command === null) return
      event.preventDefault()
      onCommand(command)
    },
    [onCommand]
  )
}
