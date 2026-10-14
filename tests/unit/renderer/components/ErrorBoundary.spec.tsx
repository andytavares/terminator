import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import { ErrorBoundary } from '../../../../src/renderer/components/ErrorBoundary'
import { useLogStore } from '../../../../src/renderer/stores/log.store'

// Suppress expected console.error output from React's own boundary reporting
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  useLogStore.setState({ entries: [] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }): JSX.Element {
  if (shouldThrow) throw new Error('Test render error')
  return <div>Content renders fine</div>
}

/** Throws until the test says the fault is gone. */
const fault = { present: true }
function FlakyChild(): JSX.Element {
  return <ThrowingChild shouldThrow={fault.present} />
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Content renders fine')).toBeTruthy()
  })

  it('renders error UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(screen.getByText('Test render error')).toBeTruthy()
  })

  it('shows recovery button when error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(screen.getByRole('button', { name: /try to recover/i })).toBeTruthy()
  })
})

describe('ErrorBoundary — writes the error to the application log', () => {
  it('writes the error to the application log', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(useLogStore.getState().entries).toContainEqual(
      expect.objectContaining({
        level: 'error',
        message: expect.stringContaining(
          '[error-boundary] Unhandled render error: Test render error'
        ),
      })
    )
  })

  it('renders the children again once recovery is asked for', () => {
    fault.present = true
    render(
      <ErrorBoundary>
        <FlakyChild />
      </ErrorBoundary>
    )
    fault.present = false
    fireEvent.click(screen.getByRole('button', { name: /try to recover/i }))
    expect(screen.getByText('Content renders fine')).toBeTruthy()
    expect(screen.queryByText('Something went wrong')).toBeNull()
  })
})

describe('ErrorBoundary — uses theme tokens for ALL fallback colors — no hardcoded hex anywhere (light-mode safe)', () => {
  it('uses theme tokens for ALL fallback colors — no hardcoded hex anywhere (light-mode safe)', () => {
    const { container } = render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    // Scan every element in the fallback subtree, not just the root container —
    // the message text and recovery button previously kept hardcoded hex that
    // rendered as dark-theme colors under [data-theme="light"].
    const all = container.querySelectorAll<HTMLElement>('*')
    expect(all.length).toBeGreaterThan(0)
    for (const el of all) {
      const style = el.getAttribute('style') ?? ''
      expect(style).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
    }
  })
})
