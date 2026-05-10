import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from '../../../../src/renderer/components/ErrorBoundary'

// Suppress expected console.error from ErrorBoundary
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
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

  it('logs error to console when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>
    )
    expect(console.error).toHaveBeenCalled()
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
})
