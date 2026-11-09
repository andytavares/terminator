import type { QuickActionGroup } from '../quick-actions/types'
import type { Mode, Row } from './QuickActions'

// The Quick Actions panel's keyboard: the same keys mean the same thing in
// every mode, and each mode adds its own.

/** What a key can read and do. */
export interface KeyContext {
  mode: Mode
  /** The rows the panel shows now, in highlight order. */
  rows: Row[]
  /** The top level's Go actions, reached by their letter. */
  goRows: Row[]
  groups: QuickActionGroup[]
  highlight: number
  query: string
  setHighlight: (update: (index: number) => number) => void
  activate: (row: Row | undefined) => void
  enterSearch: () => void
  backToTop: () => void
  openGroup: (group: QuickActionGroup) => void
  onTogglePin: (id: string) => void
  onClose: () => void
}

type Keys = Record<string, () => void>

export function handleQuickActionKey(e: KeyboardEvent, ctx: KeyContext): void {
  if ((e.metaKey || e.ctrlKey) && e.key === '.') return togglePin(e, ctx)
  if (e.key === 'Escape') return void press(e, ctx.onClose)
  if (ctx.mode === 'search') return void press(e, keyIn(searchKeys(ctx), e.key))
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (ctx.mode === 'group') return handleGroupKey(e, ctx)
  topKey(e, ctx)
}

/** The handler for `key`, never one inherited from Object. */
function keyIn(keys: Keys, key: string): (() => void) | undefined {
  return Object.prototype.hasOwnProperty.call(keys, key) ? keys[key] : undefined
}

/** Runs `run`, if there is one, in place of the key's default. */
function press(e: KeyboardEvent, run: (() => void) | undefined): boolean {
  if (!run) return false
  e.preventDefault()
  run()
  return true
}

/** ⌘. pins or unpins the highlighted action; a group row has nothing to pin. */
function togglePin(e: KeyboardEvent, ctx: KeyContext): void {
  const row = ctx.rows[ctx.highlight]
  if (row?.kind !== 'action') return
  e.preventDefault()
  ctx.onTogglePin(row.action.id)
}

/** Up, down, and Enter to run what is highlighted. */
function listKeys(ctx: KeyContext): Keys {
  return {
    ArrowDown: () => ctx.setHighlight((i) => Math.min(i + 1, ctx.rows.length - 1)),
    ArrowUp: () => ctx.setHighlight((i) => Math.max(i - 1, 0)),
    Enter: () => ctx.activate(ctx.rows[ctx.highlight]),
  }
}

/** Searching: the list keys, and Backspace in an empty box goes back to the top. */
function searchKeys(ctx: KeyContext): Keys {
  return ctx.query === '' ? { ...listKeys(ctx), Backspace: ctx.backToTop } : listKeys(ctx)
}

/** In a group: the list keys, Backspace to go back, "/" to search, or an action's letter. */
function handleGroupKey(e: KeyboardEvent, ctx: KeyContext): void {
  const keys: Keys = { ...listKeys(ctx), Backspace: ctx.backToTop, '/': ctx.enterSearch }
  if (press(e, keyIn(keys, e.key)) || e.key.length !== 1) return
  press(e, byMnemonic(ctx.rows, e.key, ctx))
}

/** At the top: the list keys, "/" to search, a group's letter, or a Go action's. */
function topKey(e: KeyboardEvent, ctx: KeyContext): void {
  const keys: Keys = { ...listKeys(ctx), '/': ctx.enterSearch }
  if (press(e, keyIn(keys, e.key)) || e.key.length !== 1) return
  const group = ctx.groups.find((g) => g.mnemonic === e.key)
  press(e, group ? () => ctx.openGroup(group) : byMnemonic(ctx.goRows, e.key, ctx))
}

/** Running the action among `rows` whose letter is `key`, if one has it. Case matters. */
function byMnemonic(rows: Row[], key: string, ctx: KeyContext): (() => void) | undefined {
  const row = rows.find((r) => r.kind === 'action' && r.action.mnemonic === key)
  return row ? () => ctx.activate(row) : undefined
}
