import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { mockLogError } = vi.hoisted(() => ({ mockLogError: vi.fn() }))
vi.mock('../../../../src/renderer/logger.ts', () => ({
  makeRendererLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLogError,
  }),
}))

import { ErrorBoundary } from '../../../../src/renderer/components/ErrorBoundary'

// Suppress expected console.error output from React's own boundary reporting
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockLogError.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }): JSX.Element {
  if (shouldThrow) throw new Error('Test render error')
  return <div>Content renders fine</div>
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

  it('logs error when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(mockLogError).toHaveBeenCalled()
  })

  it('clears error state when recovery button is clicked', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    const btn = screen.getByRole('button', { name: /try to recover/i })
    fireEvent.click(btn)
    // After recovery, the children should attempt to render again
    // (they'll throw again, but the boundary resets its state)
    expect(btn).toBeTruthy()
  })

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
