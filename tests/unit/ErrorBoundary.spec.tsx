import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import { ErrorBoundary } from '../../src/renderer/components/ErrorBoundary'

function ThrowOnRender({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('Test render error')
  return <div>all good</div>
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ThrowOnRender shouldThrow={false} />
      </ErrorBoundary>
    )
    expect(screen.getByText('all good')).toBeTruthy()
  })

  it('renders fallback UI when a child throws', () => {
    const originalError = console.error
    console.error = () => {}
    render(
      <ErrorBoundary>
        <ThrowOnRender shouldThrow />
      </ErrorBoundary>
    )
    console.error = originalError
    expect(screen.getByText('Something went wrong')).toBeTruthy()
  })

  it('fallback container uses CSS variable for background, not hardcoded hex', () => {
    const originalError = console.error
    console.error = () => {}
    const { container } = render(
      <ErrorBoundary>
        <ThrowOnRender shouldThrow />
      </ErrorBoundary>
    )
    console.error = originalError
    const fallback = container.firstElementChild as HTMLElement
    expect(fallback?.style.background).toContain('var(--bg-base)')
    expect(fallback?.style.background).not.toContain('#0c0c0f')
  })

  it('fallback container uses CSS variable for color, not hardcoded hex', () => {
    const originalError = console.error
    console.error = () => {}
    const { container } = render(
      <ErrorBoundary>
        <ThrowOnRender shouldThrow />
      </ErrorBoundary>
    )
    console.error = originalError
    const fallback = container.firstElementChild as HTMLElement
    expect(fallback?.style.color).toContain('var(--danger)')
    expect(fallback?.style.color).not.toContain('#f87171')
  })
})
