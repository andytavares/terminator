import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { UsageScreen } from '../../../../src/renderer/components/usage/UsageScreen'
import type { UsageFeatureRow, UsageReport } from '../../../../src/shared/usage/usage-types'

function row(
  patch: Partial<UsageFeatureRow> & Pick<UsageFeatureRow, 'id' | 'label'>
): UsageFeatureRow {
  return {
    source: 'core',
    kind: 'action',
    firstDeclared: '2026-01-01',
    lastUsedAt: null,
    declared: true,
    usesInPeriod: 0,
    usesAllTime: 0,
    activeMs: 0,
    failures: 0,
    byVia: {},
    daily: [0, 0, 0],
    ...patch,
  }
}

const REPORT: UsageReport = {
  countingSince: '2026-01-01',
  features: [
    row({
      id: 'core.home',
      label: 'Home',
      kind: 'surface',
      usesInPeriod: 40,
      usesAllTime: 50,
      activeMs: 7_200_000,
      byVia: { shown: 40 },
    }),
    row({
      id: 'core.start-work',
      label: 'Start work',
      usesInPeriod: 5,
      usesAllTime: 9,
      byVia: { shortcut: 4, palette: 1 },
      lastUsedAt: '2026-10-28T09:00:00.000Z',
    }),
    row({
      id: 'core.overview',
      label: 'Overview',
      usesAllTime: 3,
      lastUsedAt: '2026-08-01T09:00:00.000Z',
    }),
    row({
      id: 'terminator.notepad',
      label: 'Notes',
      source: 'terminator.notepad',
      kind: 'surface',
      usesInPeriod: 8,
      usesAllTime: 8,
      byVia: { click: 8 },
    }),
    row({
      id: 'terminator.notepad.export',
      label: 'Export note',
      source: 'terminator.notepad',
      kind: 'control',
    }),
    row({
      id: 'terminator.notepad.search',
      label: 'Search notes',
      source: 'terminator.notepad',
      kind: 'control',
      usesInPeriod: 2,
      usesAllTime: 2,
    }),
  ],
}

let report: ReturnType<typeof vi.fn>

function stubApi(data: UsageReport, status: 'enabled' | 'disabled' = 'enabled'): void {
  report = vi.fn(async () => ({ data }))
  window.electronAPI = {
    usage: { report },
    extension: {
      list: async () => ({
        extensions: [{ id: 'terminator.notepad', name: 'Notepad', status }],
      }),
    },
  } as unknown as typeof window.electronAPI
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 29, 12) })
  stubApi(REPORT)
})
afterEach(() => vi.useRealTimers())

async function shown(): Promise<void> {
  await screen.findByRole('table', { name: 'Feature usage' })
}

describe('UsageScreen', () => {
  it('groups features by part, Core first, with a summary line for each', async () => {
    render(<UsageScreen />)
    await shown()
    const groups = screen.getAllByRole('rowheader').map((cell) => cell.textContent)
    expect(groups).toEqual(['Core · 2 of 3 used · 45 uses', 'Notepad · 2 of 3 used · 10 uses'])
    expect(screen.getByText('Counted on this Mac since', { exact: false }).textContent).toMatch(
      /2026/
    )
  })

  it('states each feature and orders a group by uses, highest first', async () => {
    render(<UsageScreen />)
    await shown()
    const core = screen.getAllByRole('row').filter((r) => /core\./.test(r.textContent ?? ''))
    expect(core.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual([
      'Home core.home',
      'Start work core.start-work',
      'Overview core.overview',
    ])
    expect(within(core[2]).getByText('Not used in 30 days')).toBeTruthy()
    expect(
      within(screen.getByRole('row', { name: /Export note/ })).getByText('Never used')
    ).toBeTruthy()
  })
})

describe('UsageScreen — store failure', () => {
  it('keeps the screen drawn when the usage store cannot answer', async () => {
    report.mockResolvedValue({ error: 'failed', message: 'database is not open' })
    render(<UsageScreen />)
    await waitFor(() => expect(report).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: 'Usage' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('UsageScreen — summary', () => {
  it('shows the four summary cards', async () => {
    render(<UsageScreen />)
    await shown()
    const card = (question: string): string =>
      screen.getByText(question, { selector: '.tmui-metric-card__question' }).closest('div')!
        .parentElement!.textContent ?? ''
    expect(card('Features used')).toMatch(/4 of 6.*Core 2 of 3 · Extensions 2 of 3/)
    expect(card('Not used')).toMatch(/^Not used in 30 days1/)
    expect(card('Never used')).toMatch(/^Never used since added1/)
    expect(card('Active time')).toMatch(/2h.*Home 2 h 00 m/)
  })

  it('narrows the table to one state when its chip is pressed', async () => {
    render(<UsageScreen />)
    await shown()
    fireEvent.click(screen.getByRole('button', { name: /^Never used/ }))
    expect(screen.queryByRole('row', { name: /Start work/ })).toBeNull()
    expect(screen.getByRole('row', { name: /Export note/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Never used/ }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })
})

describe('UsageScreen — filters', () => {
  it('narrows the table to one part from the part menu', async () => {
    render(<UsageScreen />)
    await shown()
    fireEvent.click(screen.getByRole('button', { name: /All parts/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Notepad' }))
    expect(screen.queryByRole('row', { name: /Start work/ })).toBeNull()
    expect(screen.getByRole('row', { name: /Notes/ })).toBeTruthy()
  })

  it('asks for the report from the first day of the period, and for all time with none', async () => {
    render(<UsageScreen />)
    await shown()
    expect(report).toHaveBeenLastCalledWith({ from: '2026-09-30' })
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }))
    await waitFor(() => expect(report).toHaveBeenLastCalledWith({ from: '2026-10-23' }))
    fireEvent.click(screen.getByRole('radio', { name: 'All time' }))
    await waitFor(() => expect(report).toHaveBeenLastCalledWith({ from: null }))
  })
})

describe('UsageScreen — states', () => {
  it('marks the features of an extension that is switched off', async () => {
    stubApi(REPORT, 'disabled')
    render(<UsageScreen />)
    await shown()
    expect(
      within(screen.getByRole('row', { name: /Notes/ })).getByText('Extension off')
    ).toBeTruthy()
  })

  it('says nothing is counted yet when no feature has a use', async () => {
    stubApi({
      countingSince: '2026-10-29',
      features: [row({ id: 'core.home', label: 'Home', kind: 'surface' })],
    })
    render(<UsageScreen />)
    expect(await screen.findByRole('heading', { name: 'Nothing counted yet' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('UsageScreen — drawer', () => {
  it('opens a drawer for a row, with the controls inside a screen', async () => {
    render(<UsageScreen />)
    await shown()
    fireEvent.click(screen.getByRole('row', { name: /Notes/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Notes' })
    expect(within(drawer).getByText('8 in 30 days · 8 all time')).toBeTruthy()
    expect(within(drawer).getByRole('heading', { name: 'Inside Notes' })).toBeTruthy()
    expect(within(drawer).getByText('Search notes')).toBeTruthy()
    expect(within(drawer).getByText('Export note').parentElement?.textContent).toMatch(/Never used/)
  })
})
