import React from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ReadinessStrip } from '../../src/components/pr-review/ReadinessStrip'
import type { PrReviewDetail } from '../../src/schemas/pr-review.schema'
import { buildPr } from './overview-fixtures'

const basePr = buildPr({
  number: 42,
  statusChecks: [{ name: 'CI', state: 'pass' }],
  chapters: [],
  insights: null,
})

const idleBranch = {
  updating: false,
  resolving: false,
  error: null as string | null,
  onUpdate: () => {},
  onResolve: () => {},
}

function renderStrip(overrides: Partial<PrReviewDetail> = {}, branch = idleBranch, you = false) {
  return render(
    <ReadinessStrip pr={{ ...basePr, ...overrides }} youAreRequested={you} branch={branch} />
  )
}

const approval = (author: string) => ({ author, authorAvatarUrl: '', submittedAt: '2026-01-02' })

describe('ReadinessStrip checks', () => {
  const checks = [
    { name: 'ruff', state: 'fail' as const },
    { name: 'lint', state: 'fail' as const },
    { name: 'build', state: 'pass' as const },
  ]

  it('names the failing checks and opens them failing-first', () => {
    renderStrip({ statusChecks: checks })
    const cell = screen.getByRole('button', { name: /2 of 3 checks failing/ })
    expect(cell.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(cell)
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(headings).toEqual(['Failing · 2', 'Passing · 1'])
  })

  it('says so when there are no checks', () => {
    renderStrip({ statusChecks: [] })
    expect(screen.getByText('No checks')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /check/ })).toBeNull()
  })

  it('does not tone skipped-only checks as passing', () => {
    renderStrip({ statusChecks: [{ name: 'deploy', state: 'skipped' }] })
    const cell = screen.getByRole('button', { name: /^Checks/ }).closest('.rs-cell')
    expect(cell?.className).toContain('rs-cell--quiet')
    expect(cell?.className).not.toContain('rs-cell--ok')
  })

  it('reports pending checks', () => {
    renderStrip({ statusChecks: [{ name: 'CI', state: 'pending' }] })
    expect(screen.getByText('1 of 1 check pending')).toBeTruthy()
  })
})

describe('ReadinessStrip reviews', () => {
  it('lists approvals and who is still awaited', () => {
    renderStrip({ approvals: [approval('bob'), approval('cy')], requestedReviewers: ['dee'] })
    expect(screen.getByText('Approved by bob, cy · waiting on dee')).toBeTruthy()
  })

  it('shows waiting only when nobody has approved', () => {
    renderStrip({ requestedReviewers: ['dee'] })
    expect(screen.getByText('Waiting on dee')).toBeTruthy()
  })

  it('flags that you were asked', () => {
    renderStrip({ requestedReviewers: ['me'] }, idleBranch, true)
    expect(screen.getByText('Your review requested')).toBeTruthy()
  })

  it('says nobody was asked', () => {
    renderStrip()
    expect(screen.getByText('None requested')).toBeTruthy()
  })
})

describe('ReadinessStrip merge', () => {
  it('reports a clean merge against the base', () => {
    renderStrip()
    expect(screen.getByText('No conflicts with main')).toBeTruthy()
  })

  it('offers resolving when conflicting', () => {
    const calls: string[] = []
    renderStrip({ mergeStateStatus: 'dirty' }, { ...idleBranch, onResolve: () => calls.push('r') })
    expect(screen.getByText('Conflicts with main')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve conflicts' }))
    expect(calls).toEqual(['r'])
  })

  it('shows the busy label while preparing the merge', () => {
    renderStrip({ mergeStateStatus: 'dirty' }, { ...idleBranch, resolving: true })
    const busy = screen.getByRole('button', { name: 'Preparing merge…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
  })
})

describe('ReadinessStrip branch actions', () => {
  it('offers updating when behind, busy while updating', () => {
    const calls: string[] = []
    const view = renderStrip(
      { mergeStateStatus: 'behind' },
      { ...idleBranch, onUpdate: () => calls.push('u') }
    )
    expect(screen.getByText('Behind main')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update from main' }))
    expect(calls).toEqual(['u'])
    view.unmount()
    renderStrip({ mergeStateStatus: 'behind' }, { ...idleBranch, updating: true })
    expect(screen.getByRole('button', { name: 'Updating…' })).toBeTruthy()
  })

  it('says when the merge state is not reported', () => {
    renderStrip({ mergeStateStatus: 'unknown' })
    expect(screen.getByText('Not reported')).toBeTruthy()
  })

  it('shows a branch error as an alert', () => {
    renderStrip({}, { ...idleBranch, error: 'Could not update the branch' })
    expect(screen.getByRole('alert').textContent).toBe('Could not update the branch')
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

/** The text of a rule's body in the strip's stylesheet; happy-dom drops color-mix() values. */
function declared(selector: string): string {
  const css = fs.readFileSync(path.resolve(__dirname, STRIP_CSS), 'utf8')
  return css.match(new RegExp(`^${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'm'))?.[1] ?? ''
}

const STRIP_CSS = '../../src/components/pr-review/readiness-strip.css'

/** Whether an icon draws in its parent's text colour, the flat-icons rule. */
function inheritsTextColour(icon: Element): boolean {
  return getComputedStyle(icon).color === getComputedStyle(icon.parentElement as Element).color
}

describe('ReadinessStrip — status and flat icons', () => {
  let removeStylesheet = () => {}
  beforeEach(() => {
    removeStylesheet = addStylesheet('readiness-strip.css')
  })
  afterEach(() => removeStylesheet())

  it('is named Status for assistive technology', () => {
    renderStrip()
    expect(screen.getByRole('group', { name: 'Status' })).toBeTruthy()
  })

  it("draws every icon in its cell's text colour, the quiet one at 60%", () => {
    renderStrip({ statusChecks: [], requestedReviewers: ['dee'], mergeStateStatus: 'unknown' })
    const icons = [...document.querySelectorAll('.rs-icon')]
    expect(icons.map((icon) => icon.getAttribute('data-tone'))).toEqual(['quiet', 'wait', 'quiet'])
    expect(icons.filter((icon) => !inheritsTextColour(icon))).toEqual([])
    expect(icons.map((icon) => getComputedStyle(icon).opacity)).toEqual(['0.6', '', '0.6'])
  })

  it('keeps the failing cell tinted with a red label, and its icon flat', () => {
    renderStrip({ statusChecks: [{ name: 'CI', state: 'fail' }], mergeStateStatus: 'clean' })
    const icon = document.querySelector('.rs-cell--bad .rs-icon') as Element
    const cell = icon.closest('.rs-cell') as Element
    expect(inheritsTextColour(icon)).toBe(true)
    const danger = getComputedStyle(document.documentElement).getPropertyValue('--tm-danger')
    expect(getComputedStyle(cell.querySelector('.rs-label') as Element).color).toBe(danger.trim())
    expect(declared('.rs-cell--bad')).toContain('background: color-mix(in srgb, var(--tm-danger)')
  })
})
