import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from '../../../src/renderer/App'

// Each view is its own chunk (React.lazy), so the bundle's first script stays
// under the renderer's chunk budget. A mock factory runs only when its module
// is imported, so the list shows which views a page actually loaded.
const loaded = vi.hoisted((): string[] => [])

vi.mock('../../../src/components/GitFullView', () => {
  loaded.push('GitFullView')
  return { GitFullView: () => <div data-testid="git-full-view" /> }
})
vi.mock('../../../src/components/pr-review/PrReviewTab', () => {
  loaded.push('PrReviewTab')
  return { PrReviewTab: () => <div data-testid="pr-review-tab" /> }
})
vi.mock('../../../src/components/pr-review/ReviewDashboard', () => {
  loaded.push('ReviewDashboard')
  return { ReviewDashboard: () => <div data-testid="review-dashboard" /> }
})

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { search: '?view=project&repoRoot=%2Fmy%2Frepo' },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { on: vi.fn(() => vi.fn()) } },
    configurable: true,
    writable: true,
  })
})

describe('git-integration renderer App code splitting', () => {
  it('loads only the module of the view the page shows', async () => {
    render(<App />)
    expect(await screen.findByTestId('git-full-view')).toBeDefined()
    expect(loaded).toEqual(['GitFullView'])
  })
})
