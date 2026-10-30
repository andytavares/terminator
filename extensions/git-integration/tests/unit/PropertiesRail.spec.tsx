import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { PropertiesRail } from '../../src/components/pr-review/PropertiesRail'
import type { PrReviewDetail } from '../../src/schemas/pr-review.schema'
import { buildPr } from './overview-fixtures'

const rail = () => within(screen.getByRole('complementary', { name: 'Pull request details' }))

beforeEach(() => {
  Object.assign(window, {
    electronAPI: { shell: { openExternal: vi.fn().mockResolvedValue(undefined) } },
  })
})

describe('PropertiesRail — Signals', () => {
  it('shows the risk level with its hotspot underneath', () => {
    render(<PropertiesRail pr={buildPr()} />)
    expect(rail().getByText('High')).toBeTruthy()
    expect(rail().getByText('playwright.config.ts (Wide blast radius — 41 importers)')).toBeTruthy()
  })

  it('shows how many changed functions have a test', () => {
    render(<PropertiesRail pr={buildPr()} />)
    expect(rail().getByText('5 of 7 functions')).toBeTruthy()
  })

  it('says the analysis is running while insights are missing', () => {
    render(<PropertiesRail pr={buildPr({ insights: null })} />)
    expect(rail().getByText('Analysing this PR…')).toBeTruthy()
    expect(rail().queryByText('Tests')).toBeNull()
  })

  it('carries each signal source as its tooltip', () => {
    render(<PropertiesRail pr={buildPr()} />)
    expect(rail().getAllByTitle('CI check codecov/patch').length).toBeGreaterThan(0)
  })
})

describe('PropertiesRail — Details', () => {
  it('lists branch, base, the short head and no linked issues', () => {
    render(
      <PropertiesRail
        pr={buildPr({ headSHA: 'abc1234def5678', openedAt: '2026-10-07T12:00:00Z' })}
      />
    )
    expect(rail().getByText('feature/e2e-sharding')).toBeTruthy()
    expect(rail().getByText('main')).toBeTruthy()
    expect(rail().getByText('abc1234')).toBeTruthy()
    expect(rail().getByText('alice')).toBeTruthy()
    expect(rail().getByText('Oct 7, 2026')).toBeTruthy()
    expect(rail().getByText('No linked issues')).toBeTruthy()
  })
})

describe('PropertiesRail — linked issues', () => {
  it('opens a linked issue in the browser rather than inside the view', () => {
    const url = 'https://linear.app/t/issue/TER-12'
    const issueRefs: PrReviewDetail['issueRefs'] = [{ ref: 'TER-12', type: 'linear', url }]
    render(<PropertiesRail pr={buildPr({ issueRefs })} />)
    const link = rail().getByRole('link', { name: 'TER-12' })
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
    expect(window.electronAPI.shell.openExternal).toHaveBeenCalledWith(url)
  })

  it('renders a linked issue with its ref and title', () => {
    const issueRefs = [{ ref: 'TER-12', type: 'linear', title: 'Batch the ledger' }]
    render(<PropertiesRail pr={buildPr({ issueRefs: issueRefs as PrReviewDetail['issueRefs'] })} />)
    expect(rail().getByText('TER-12')).toBeTruthy()
    expect(rail().getByText('Batch the ledger')).toBeTruthy()
    expect(rail().queryByText('No linked issues')).toBeNull()
  })

  it('copies the branch name and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<PropertiesRail pr={buildPr()} />)
    fireEvent.click(rail().getByRole('button', { name: 'Copy branch name' }))
    await waitFor(() => expect(rail().getByText('Copied')).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith('feature/e2e-sharding')
  })
})

const TOKENS = path.resolve(__dirname, '../../../../packages/extension-ui/src/tokens.css')

/** Adds the design tokens and one of the overview's stylesheets to the document, so the icons'
 *  colours can be computed. */
function addStylesheet(file: string): () => void {
  const style = document.createElement('style')
  const sheet = path.resolve(__dirname, '../../src/components/pr-review', file)
  style.textContent = [TOKENS, sheet].map((css) => fs.readFileSync(css, 'utf8')).join('\n')
  document.head.append(style)
  return () => style.remove()
}

/** Whether an icon draws in its parent's text colour, the flat-icons rule. */
function inheritsTextColour(icon: Element): boolean {
  return getComputedStyle(icon).color === getComputedStyle(icon.parentElement as Element).color
}

describe('PropertiesRail — flat icons', () => {
  let removeStylesheet = () => {}
  beforeEach(() => {
    removeStylesheet = addStylesheet('properties-rail.css')
  })
  afterEach(() => removeStylesheet())

  it("draws every signal icon in its row's text colour, a neutral one at 60%", () => {
    render(<PropertiesRail pr={buildPr()} />)
    const icons = [...document.querySelectorAll('.pr-rail-signal-icon')]
    const neutral = icons.filter((icon) => icon.closest('.pr-rail-signal--neutral'))
    expect(icons.length).toBeGreaterThan(neutral.length)
    expect(neutral.length).toBeGreaterThan(0)
    expect(icons.filter((icon) => !inheritsTextColour(icon))).toEqual([])
    expect(neutral.map((icon) => getComputedStyle(icon).opacity)).toEqual(neutral.map(() => '0.6'))
  })
})
