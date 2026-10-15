import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  FileHeader,
  type FileHeaderProps,
} from '../../src/components/pr-review/diff-pane/FileHeader'
import type { PrChangedFile } from '../../src/schemas/pr-review.schema'
import { partialFake } from '../../../../tests/support/fakes'

const { stubViewMenu } = vi.hoisted(() => ({ stubViewMenu: () => null }))
vi.mock('../../src/components/pr-review/ViewMenu', () => ({ ViewMenu: stubViewMenu }))

function changedFileAt(level: 'low' | 'medium' | 'high', churn90d: number | null): PrChangedFile {
  return partialFake<PrChangedFile>({
    path: 'backend/hardware.py',
    additions: 121,
    deletions: 38,
    whyHere: 'defines InputPin.debounce_ms',
    riskScore: partialFake<PrChangedFile['riskScore']>({
      level,
      metrics: partialFake<PrChangedFile['riskScore']['metrics']>({ churn90d }),
    }),
  })
}

function renderFileHeader(file: PrChangedFile, over: Partial<FileHeaderProps> = {}) {
  const props = partialFake<FileHeaderProps>({
    file,
    isViewed: false,
    viewedFiles: new Set<string>(),
    showChangedSince: false,
    usesWithDef: [],
    menuNote: null,
    onShowRisk: vi.fn(),
    onPeekDefinition: vi.fn(),
    setViewed: vi.fn(),
    ...over,
  })
  return render(<FileHeader {...props} />)
}

describe('FileHeader', () => {
  it('shows the folder and the file name separately, with the full path on hover', () => {
    renderFileHeader(changedFileAt('low', null))
    expect(screen.getByText('backend/')).toBeTruthy()
    expect(screen.getByText('hardware.py')).toBeTruthy()
    expect(screen.getByTitle('backend/hardware.py')).toBeTruthy()
  })

  it('shows the lines added and removed', () => {
    renderFileHeader(changedFileAt('low', null))
    expect(screen.getByText('+121')).toBeTruthy()
    expect(screen.getByText('−38')).toBeTruthy()
  })

  it.each(['low', 'medium'] as const)('shows no risk chip for %s risk', (level) => {
    renderFileHeader(changedFileAt(level, null))
    expect(screen.queryByRole('button', { name: /risk/i })).toBeNull()
  })

  it('shows the High risk chip as the button that explains the risk', () => {
    const onShowRisk = vi.fn()
    renderFileHeader(changedFileAt('high', null), { onShowRisk })
    const chip = screen.getByRole('button', { name: /High risk/ })
    chip.click()
    expect(onShowRisk).toHaveBeenCalledTimes(1)
  })
})

describe('FileHeader — Why this file', () => {
  it.each(['low', 'medium'] as const)(
    'opens the explanation from the second line for %s risk',
    (level) => {
      const onShowRisk = vi.fn()
      renderFileHeader(changedFileAt(level, null), { onShowRisk })
      screen.getByRole('button', { name: 'Why this file' }).click()
      expect(onShowRisk).toHaveBeenCalledTimes(1)
    }
  )

  it('leaves the High risk chip as the only way in for high risk', () => {
    renderFileHeader(changedFileAt('high', null))
    expect(screen.queryByRole('button', { name: 'Why this file' })).toBeNull()
  })
})

describe('FileHeader second row', () => {
  it('says why the file is here', () => {
    renderFileHeader(changedFileAt('low', null))
    expect(screen.getByText(/Why here:/).parentElement?.textContent).toBe(
      'Why here: defines InputPin.debounce_ms'
    )
  })

  it('says how often the file changed, in the singular too', () => {
    renderFileHeader(changedFileAt('low', 31))
    expect(screen.getByText('Changed 31 times in 90 days')).toBeTruthy()
    renderFileHeader(changedFileAt('low', 1))
    expect(screen.getByText('Changed 1 time in 90 days')).toBeTruthy()
  })

  it('leaves out the churn line when it is unknown', () => {
    renderFileHeader(changedFileAt('low', null))
    expect(screen.queryByText(/in 90 days/)).toBeNull()
  })

  it('has a Viewed checkbox with its key hint', () => {
    renderFileHeader(changedFileAt('low', null))
    expect(screen.getByRole('checkbox', { name: /Viewed/ })).toBeTruthy()
    expect(screen.getByText('v')).toBeTruthy()
  })
})
