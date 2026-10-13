import React, { useEffect, useState } from 'react'
import { Popover } from '@terminator/extension-ui'
import { githubAPI } from '../../api/github'
import './tests-popover.css'

export interface TestBlock {
  repoRoot: string
  headSHA: string
  path: string
  code: string
  hunkHeader?: string
}

interface TestLocation {
  path: string
  line: number
  symbol: string
  text: string
}

interface Props {
  block: TestBlock
  /** Paths changed by the PR; a test among them opens in the review instead of the editor. */
  prPaths: Set<string>
  onOpenInReview: (path: string, line: number) => void
  onClose: () => void
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; symbols: string[]; locations: TestLocation[] }

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

function useTestSearch(block: TestBlock): State {
  const [state, setState] = useState<State>({ phase: 'loading' })
  useEffect(() => {
    let live = true
    githubAPI
      .testsForBlock(block)
      .then((res) => {
        if (!live) return
        const r = res as { error?: string; symbols?: string[]; locations?: TestLocation[] }
        if (r.error) setState({ phase: 'error', message: r.error })
        else setState({ phase: 'done', symbols: r.symbols ?? [], locations: r.locations ?? [] })
      })
      .catch((e: unknown) => live && setState({ phase: 'error', message: String(e) }))
    return () => {
      live = false
    }
  }, [block])
  return state
}

/** What the search found when it lists nothing: no symbol to search for, or no test naming one. */
function SearchNote({ state }: { state: State }) {
  if (state.phase === 'loading') return <p className="tp-note">Searching the tests…</p>
  if (state.phase === 'error') {
    return <p className="tp-note">Could not search the tests: {state.message}</p>
  }
  if (state.symbols.length === 0) {
    return (
      <p className="tp-note">
        This block does not define or sit inside a named function, so there is nothing to search the
        tests for.
      </p>
    )
  }
  if (state.locations.length === 0) {
    return <p className="tp-note">No test mentions {listNames(state.symbols)}.</p>
  }
  return null
}

/** A test outside the PR opens in the editor, which a gh: root without a checkout cannot do. */
function LocationRow(props: { loc: TestLocation; inPr: boolean; onOpen: () => void }) {
  const { loc } = props
  return (
    <li>
      <button type="button" className="tp-row" onClick={props.onOpen}>
        <span className="tp-where">{`${loc.path}:${loc.line}`}</span>
        <span className="tp-action">{props.inPr ? 'Open in review' : 'Open file'}</span>
        <code className="tp-text">{loc.text}</code>
      </button>
    </li>
  )
}

/** A test in the PR opens in the review; any other in the editor. */
function openerFor(props: Props) {
  return (loc: TestLocation) => {
    if (props.prPaths.has(loc.path)) props.onOpenInReview(loc.path, loc.line)
    else window.electronAPI.shell.openPath(`${props.block.repoRoot}/${loc.path}`).catch(() => {})
    props.onClose()
  }
}

export function TestsPopover(props: Props) {
  const { block, prPaths, onClose } = props
  const state = useTestSearch(block)
  const open = openerFor(props)
  const canOpenOutside = !block.repoRoot.startsWith('gh:')
  const shown =
    state.phase === 'done'
      ? state.locations.filter((l) => prPaths.has(l.path) || canOpenOutside)
      : []
  return (
    <Popover label="Tests for this block" className="tp-popover" onDismiss={onClose}>
      <div className="tp-head">Tests for this block</div>
      <SearchNote state={state} />
      {state.phase === 'done' && state.locations.length > 0 && (
        <ul className="tp-list">
          {shown.map((loc) => (
            <LocationRow
              key={`${loc.path}:${loc.line}`}
              loc={loc}
              inPr={prPaths.has(loc.path)}
              onOpen={() => open(loc)}
            />
          ))}
        </ul>
      )}
    </Popover>
  )
}
