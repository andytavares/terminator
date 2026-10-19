import { useState } from 'react'
import { useDeskSelection, useOrderedThreadKeys } from './desk-selection'
import { useHomeView } from './home-view'
import { openAsk, replyToSession, runAskAction } from './desk-actions'
import type { DeskKeyCommand } from './use-desk-keys'
import type { DeskState } from './useDeskModel'
import { useDismissalsStore } from '../../home/dismissals'
import { askSignature } from '../../home/desk-order'
import type { DeskAsk } from '../../home/core-asks'
import { revealSession } from '../../terminal/navigate-to-session'

/** Where the keyboard is in the band: the row, the one opened in place, the one being snoozed. */
export interface DeskCursor {
  selectedId: string | null
  expandedId: string | null
  snoozingId: string | null
  /** The expanded ask's reply field takes focus when it opens. */
  replying: boolean
}

export interface AskHandlers {
  select: (id: string) => void
  activate: (ask: DeskAsk) => void
  act: (ask: DeskAsk, actionId: string) => void
  replyToAsk: (ask: DeskAsk, text: string) => void
  snooze: (ask: DeskAsk, until: number) => void
  openSnoozeMenu: (ask: DeskAsk) => void
  closeSnoozeMenu: () => void
  openTerminal: (ask: DeskAsk) => void
  markAskDone: (ask: DeskAsk) => void
  collapse: () => void
}

const NO_CURSOR: DeskCursor = {
  selectedId: null,
  expandedId: null,
  snoozingId: null,
  replying: false,
}

/** The ask to put the selection on once `id` leaves the band. */
function askAfter(asks: readonly DeskAsk[], id: string): string | null {
  const index = asks.findIndex((ask) => ask.id === id)
  return (asks[index + 1] ?? asks[index - 1])?.id ?? null
}

/** The handlers that take an ask out of the band: they move the selection on as they go. */
function useLeavingHandlers(asks: readonly DeskAsk[], setCursor: SetCursor) {
  const leave = (ask: DeskAsk): void =>
    setCursor(() => ({ ...NO_CURSOR, selectedId: askAfter(asks, ask.id) }))
  return {
    leave,
    replyToAsk: (ask: DeskAsk, text: string): void => {
      if (ask.sessionId) replyToSession(ask.sessionId, text)
      leave(ask)
    },
    snooze: (ask: DeskAsk, until: number): void => {
      leave(ask)
      useDismissalsStore.getState().snooze(ask.id, until, askSignature(ask))
    },
    markAskDone: (ask: DeskAsk): void => {
      leave(ask)
      useDismissalsStore.getState().markDone(ask.id)
    },
  }
}

type SetCursor = (next: (cursor: DeskCursor) => DeskCursor) => void

function useAskHandlers(asks: readonly DeskAsk[], setCursor: SetCursor): AskHandlers {
  const { leave, ...leaving } = useLeavingHandlers(asks, setCursor)
  return {
    ...leaving,
    select: (id) => {
      useDeskSelection.getState().select(null)
      setCursor((c) => ({ ...c, selectedId: id }))
    },
    activate: (ask) => {
      if (ask.kind !== 'answer') return void openAsk(ask)
      setCursor((c) =>
        c.expandedId === ask.id
          ? { ...c, expandedId: null }
          : { ...c, selectedId: ask.id, expandedId: ask.id }
      )
    },
    act: (ask, actionId) => {
      if (actionId === 'reply') {
        return setCursor((c) => ({ ...c, selectedId: ask.id, expandedId: ask.id, replying: true }))
      }
      void runAskAction(ask, actionId)
      if (actionId.startsWith('choice-')) leave(ask)
    },
    ...useMenuHandlers(setCursor),
  }
}

function useMenuHandlers(setCursor: SetCursor) {
  return {
    openSnoozeMenu: (ask: DeskAsk): void =>
      setCursor((c) => ({ ...c, selectedId: ask.id, snoozingId: ask.id })),
    closeSnoozeMenu: (): void => setCursor((c) => ({ ...c, snoozingId: null })),
    collapse: (): void => setCursor((c) => ({ ...c, expandedId: null, replying: false })),
    openTerminal: (ask: DeskAsk): void => {
      if (ask.sessionId) revealSession(ask.sessionId)
    },
  }
}

/** Every stop for J and K: the band's asks, then In flight's rows. */
function placesOf(asks: readonly DeskAsk[], threadKeys: readonly string[]): string[] {
  return [...asks.map((ask) => `ask:${ask.id}`), ...threadKeys.map((key) => `thread:${key}`)]
}

/** The place `step` away from `current`, stopping at either end. */
function placeFrom(places: readonly string[], current: string | null, step: 1 | -1): string | null {
  const at = current === null ? -1 : places.indexOf(current)
  const target = at === -1 ? (step === 1 ? 0 : places.length - 1) : at + step
  return places[Math.min(Math.max(target, 0), places.length - 1)] ?? null
}

export interface DeskController {
  cursor: DeskCursor
  handlers: AskHandlers
  onCommand: (command: DeskKeyCommand) => void
}

interface MoveInput {
  asks: readonly DeskAsk[]
  threadKeys: readonly string[]
  selectedId: string | null
  threadKey: string | null
  handlers: AskHandlers
  resetCursor: () => void
}

/** J and K: to the next ask, then on to In flight's rows. */
function moveSelection(step: 1 | -1, input: MoveInput): void {
  const { asks, threadKeys, selectedId, threadKey, handlers, resetCursor } = input
  const current = selectedId ? `ask:${selectedId}` : threadKey ? `thread:${threadKey}` : null
  const next = placeFrom(placesOf(asks, threadKeys), current, step)
  if (next?.startsWith('ask:')) handlers.select(next.slice('ask:'.length))
  if (next?.startsWith('thread:')) {
    resetCursor()
    useDeskSelection.getState().select(next.slice('thread:'.length))
  }
}

/** The Desk's cursor and what each key does to it. */
export function useDeskController(desk: DeskState): DeskController {
  const { asks } = desk
  const [stored, setCursor] = useState<DeskCursor>(NO_CURSOR)
  const threadKey = useDeskSelection((s) => s.selectedThreadKey)
  const threadKeys = useOrderedThreadKeys()
  const handlers = useAskHandlers(asks, setCursor)
  const showView = useHomeView((s) => s.show)

  // The selection falls back to the first ask once its own has left, and yields to In flight's.
  const stillThere = asks.some((ask) => ask.id === stored.selectedId)
  const fallback = stillThere ? stored.selectedId : (asks[0]?.id ?? null)
  const cursor = { ...stored, selectedId: threadKey !== null ? null : fallback }
  const selected = asks.find((ask) => ask.id === cursor.selectedId)
  const move = { asks, threadKeys, threadKey, handlers, selectedId: cursor.selectedId }

  const onCommand = (command: DeskKeyCommand): void => {
    if (command.kind === 'move') {
      return moveSelection(command.step, { ...move, resetCursor: () => setCursor(() => NO_CURSOR) })
    }
    if (command.kind === 'view') return showView(command.view)
    if (command.kind === 'open' && threadKey !== null)
      return useDeskSelection.getState().openThread(threadKey)
    if (command.kind === 'escape') return closeInnermost(cursor, handlers)
    if (selected) runSelectedAskKey(selected, command, handlers)
  }
  return { cursor, handlers, onCommand }
}

/** Closes the snooze menu, else the opened ask, else the thread drawer. */
function closeInnermost(cursor: DeskCursor, handlers: AskHandlers): void {
  if (cursor.snoozingId !== null) return handlers.closeSnoozeMenu()
  if (cursor.expandedId !== null) return handlers.collapse()
  useDeskSelection.getState().closeThread()
}

/** What a key does to the selected ask. */
function runSelectedAskKey(ask: DeskAsk, command: DeskKeyCommand, handlers: AskHandlers): void {
  if (command.kind === 'open') handlers.activate(ask)
  if (command.kind === 'reply' && ask.kind === 'answer') handlers.act(ask, 'reply')
  if (command.kind === 'snooze') handlers.openSnoozeMenu(ask)
  if (command.kind === 'terminal') handlers.openTerminal(ask)
  if (command.kind === 'done') handlers.markAskDone(ask)
  if (command.kind === 'choose' && ask.actions.some((a) => a.id === `choice-${command.number}`))
    handlers.act(ask, `choice-${command.number}`)
}
