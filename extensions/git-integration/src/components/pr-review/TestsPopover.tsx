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

export function TestsPopover({ block, prPaths, onOpenInReview, onClose }: Props) {
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

  const open = (loc: TestLocation) => {
    if (prPaths.has(loc.path)) {
      onOpenInReview(loc.path, loc.line)
    } else {
      window.electronAPI.shell.openPath(`${block.repoRoot}/${loc.path}`).catch(() => {})
    }
    onClose()
  }

  const canOpenOutside = !block.repoRoot.startsWith('gh:')

  return (
    <Popover label="Tests for this block" className="tp-popover" onDismiss={onClose}>
      <div className="tp-head">Tests for this block</div>
      {state.phase === 'loading' && <p className="tp-note">Searching the tests…</p>}
      {state.phase === 'error' && (
        <p className="tp-note">Could not search the tests: {state.message}</p>
      )}
      {state.phase === 'done' && state.symbols.length === 0 && (
        <p className="tp-note">
          This block does not define or sit inside a named function, so there is nothing to search
          the tests for.
        </p>
      )}
      {state.phase === 'done' && state.symbols.length > 0 && state.locations.length === 0 && (
        <p className="tp-note">No test mentions {listNames(state.symbols)}.</p>
      )}
      {state.phase === 'done' && state.locations.length > 0 && (
        <ul className="tp-list">
          {state.locations.map((loc) => {
            const inPr = prPaths.has(loc.path)
            if (!inPr && !canOpenOutside) return null
            return (
              <li key={`${loc.path}:${loc.line}`}>
                <button type="button" className="tp-row" onClick={() => open(loc)}>
                  <span className="tp-where">{`${loc.path}:${loc.line}`}</span>
                  <span className="tp-action">{inPr ? 'Open in review' : 'Open file'}</span>
                  <code className="tp-text">{loc.text}</code>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Popover>
  )
}
