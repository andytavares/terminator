import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  FileHeader,
  type FileHeaderProps,
} from '../../src/components/pr-review/diff-pane/FileHeader'
import type { PrChangedFile } from '../../src/schemas/pr-review.schema'
import { partialFake } from '../../../../packages/test-support/src/fakes'

function changedFileAt(churn90d: number | null, whyHere = 'defines InputPin.debounce_ms') {
  return partialFake<PrChangedFile>({
    path: 'backend/hardware.py',
    additions: 121,
    deletions: 38,
    whyHere,
    churn90d,
  })
}

function renderFileHeader(file: PrChangedFile, over: Partial<FileHeaderProps> = {}) {
  const props = partialFake<FileHeaderProps>({
    file,
    viewedFiles: new Set<string>(),
    showChangedSince: false,
    usesWithDef: [],
    menuNote: null,
    onPeekDefinition: vi.fn(),
    ...over,
  })
  return render(<FileHeader {...props} />)
}

describe('FileHeader', () => {
  it('shows the folder and the file name separately, with the full path on hover', () => {
    renderFileHeader(changedFileAt(null))
    expect(screen.getByText('backend/')).toBeTruthy()
    expect(screen.getByText('hardware.py')).toBeTruthy()
    expect(screen.getByTitle('backend/hardware.py')).toBeTruthy()
  })

  it('shows the lines added and removed', () => {
    renderFileHeader(changedFileAt(null))
    expect(screen.getByText('+121')).toBeTruthy()
    expect(screen.getByText('−38')).toBeTruthy()
  })

  it('shows no risk chip and no Why this file button', () => {
    renderFileHeader(changedFileAt(null))
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('FileHeader second row', () => {
  it('says why the file is here', () => {
    renderFileHeader(changedFileAt(null))
    expect(screen.getByText(/Why here:/).parentElement?.textContent).toBe(
      'Why here: defines InputPin.debounce_ms'
    )
  })

  it('says how often the file changed, in the singular too', () => {
    renderFileHeader(changedFileAt(31))
    expect(screen.getByText('Changed 31 times in 90 days')).toBeTruthy()
    renderFileHeader(changedFileAt(1))
    expect(screen.getByText('Changed 1 time in 90 days')).toBeTruthy()
  })
})

describe('FileHeader second row — the two facts', () => {
  it('separates the reason and the change count with a dot', () => {
    renderFileHeader(changedFileAt(4))
    expect(screen.getByText('·')).toBeTruthy()
  })

  it('shows only the change count when the file has no reason', () => {
    renderFileHeader(changedFileAt(4, ''))
    expect(screen.queryByText(/Why here:/)).toBeNull()
    expect(screen.queryByText('·')).toBeNull()
    expect(screen.getByText('Changed 4 times in 90 days')).toBeTruthy()
  })

  it('leaves out the churn line when it is unknown', () => {
    renderFileHeader(changedFileAt(null))
    expect(screen.queryByText(/in 90 days/)).toBeNull()
  })

  it('has no Viewed checkbox, which lives in the footer beside the next file action', () => {
    renderFileHeader(changedFileAt(null))
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('shows the note about which head the diff shows', () => {
    renderFileHeader(changedFileAt(null), { menuNote: 'Showing 9f0c76eb… head' })
    expect(screen.getByText('Showing 9f0c76eb… head')).toBeTruthy()
  })
})

function changedFileWithRadius(blastRadius: PrChangedFile['blastRadius']) {
  return partialFake<PrChangedFile>({ ...changedFileAt(null), blastRadius })
}

describe('FileHeader second row — blast radius', () => {
  it('says how many files use what the file changes', () => {
    renderFileHeader(changedFileWithRadius({ usedIn: 14, alsoDefinedIn: 0 }))
    expect(screen.getByText('Used in 14 files')).toBeTruthy()
  })

  it('adds how many other files define the same name, in the singular too', () => {
    renderFileHeader(changedFileWithRadius({ usedIn: 1, alsoDefinedIn: 2 }))
    expect(screen.getByText('Used in 1 file · name also defined in 2 files')).toBeTruthy()
  })

  it.each([
    ['unmeasured', null],
    ['used nowhere and defined nowhere else', { usedIn: 0, alsoDefinedIn: 0 }],
    ['used nowhere, though the name is defined elsewhere', { usedIn: 0, alsoDefinedIn: 2 }],
  ])('shows no blast radius when the file is %s', (_case, blastRadius) => {
    renderFileHeader(changedFileWithRadius(blastRadius))
    expect(screen.queryByText(/Used in/)).toBeNull()
  })
})
