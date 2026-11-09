import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ElectronAPI } from '../../../../../core-shared/src/electron-api/api-type'
import { electronApiOf } from '../../../../../test-support/src/electron-api'
import {
  useBugReportStore,
  reportOrigin,
  type OriginFacts,
} from '../../../../src/stores/bug-report.store'
import { useToastStore } from '../../../../src/stores/toast.store'

const submit = vi.fn<ElectronAPI['bugReport']['submit']>()
const openInBrowser = vi.fn<ElectronAPI['bugReport']['openInBrowser']>()
const openExternal = vi.fn<ElectronAPI['shell']['openExternal']>()

const REPORT = {
  title: 'Diff view goes blank',
  description: 'It went empty.',
  origin: 'Code Reviews',
  includeDetails: true,
  files: [],
}

const POSTED = {
  ok: true as const,
  number: 418,
  url: 'https://github.com/andytavares/terminator/issues/418',
}

beforeEach(() => {
  // The store only touches window.electronAPI, so that is all this node spec gives it.
  vi.stubGlobal('window', {
    electronAPI: electronApiOf({ bugReport: { submit, openInBrowser }, shell: { openExternal } }),
  })
  useBugReportStore.setState(useBugReportStore.getInitialState())
  useToastStore.setState({ toasts: [] })
})

const tabs = (entries: Array<[string, string]>) =>
  new Map(entries.map(([id, label]) => [id, { id, label }]))

/** The registry with the Home app tab and the Code Reviews repo tab, none of them active. */
function originFacts(active: Partial<OriginFacts> = {}): OriginFacts {
  return {
    globalTabs: tabs([['core.home', 'Home']]),
    workspaceTabs: tabs([['reviews', 'Code Reviews']]),
    projectTabs: tabs([]),
    activeGlobalTabId: null,
    activeWorkspaceTabId: null,
    activeProjectTabId: null,
    ...active,
  }
}

describe('reportOrigin', () => {
  it('names the app tab that covers the window', () => {
    const facts = originFacts({ activeGlobalTabId: 'core.home', activeWorkspaceTabId: 'reviews' })
    expect(reportOrigin(facts)).toBe('Home')
  })

  it('names the repo or branch tab when no app tab covers it', () => {
    expect(reportOrigin(originFacts({ activeWorkspaceTabId: 'reviews' }))).toBe('Code Reviews')
  })

  it('names the terminal when nothing covers it', () => {
    expect(reportOrigin(originFacts())).toBe('Terminal')
  })
})

describe('opening a report', () => {
  it('opens with the screen it was opened from and any text to start with', () => {
    useBugReportStore.getState().openReport({ origin: 'Home', prefill: 'Error: push failed' })

    expect(useBugReportStore.getState()).toMatchObject({
      isOpen: true,
      origin: 'Home',
      prefill: 'Error: push failed',
      phase: { name: 'editing' },
    })
  })

  it('closes', () => {
    useBugReportStore.getState().openReport({ origin: 'Home' })
    useBugReportStore.getState().close()

    expect(useBugReportStore.getState().isOpen).toBe(false)
  })
})

describe('posting a report', () => {
  it('shows the posted issue', async () => {
    submit.mockResolvedValue(POSTED)
    useBugReportStore.getState().openReport({ origin: 'Code Reviews' })

    await useBugReportStore.getState().post(REPORT)

    expect(submit).toHaveBeenCalledWith(REPORT)
    expect(useBugReportStore.getState().phase).toEqual({ name: 'posted', ...POSTED })
  })

  it('shows why it failed', async () => {
    submit.mockResolvedValue({ ok: false, error: 'SIGNED_OUT', message: 'HTTP 401' })
    useBugReportStore.getState().openReport({ origin: 'Code Reviews' })

    await useBugReportStore.getState().post(REPORT)

    expect(useBugReportStore.getState().phase).toEqual({
      name: 'failed',
      error: 'SIGNED_OUT',
      message: 'HTTP 401',
    })
  })
})

describe('posting a report after the dialog closed', () => {
  it('says so in a toast that opens the issue', async () => {
    let finish: (value: typeof POSTED) => void = () => {}
    submit.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    useBugReportStore.getState().openReport({ origin: 'Code Reviews' })

    const posting = useBugReportStore.getState().post(REPORT)
    useBugReportStore.getState().close()
    finish(POSTED)
    await posting

    const [toast] = useToastStore.getState().toasts
    expect(toast).toMatchObject({ type: 'success', message: 'Bug report posted as issue #418' })
    toast.action?.onSelect()
    expect(openExternal).toHaveBeenCalledWith(POSTED.url)
  })

  it('says it failed in a toast', async () => {
    submit.mockResolvedValue({ ok: false, error: 'FAILED', message: 'upload failed' })
    useBugReportStore.getState().openReport({ origin: 'Code Reviews' })

    const posting = useBugReportStore.getState().post(REPORT)
    useBugReportStore.getState().close()
    await posting

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      message: 'Bug report not posted: upload failed',
    })
  })
})

describe('finishing in the browser', () => {
  it('opens the form and closes the dialog', async () => {
    openInBrowser.mockResolvedValue({ ok: true })
    useBugReportStore.getState().openReport({ origin: 'Code Reviews' })

    await useBugReportStore.getState().finishInBrowser(REPORT)

    expect(openInBrowser).toHaveBeenCalledWith(REPORT)
    expect(useBugReportStore.getState().phase).toEqual({ name: 'in-browser' })
  })

  it('shows why the browser could not be opened', async () => {
    openInBrowser.mockResolvedValue({ ok: false, error: 'VALIDATION_ERROR', message: 'Bad file' })
    useBugReportStore.getState().openReport({ origin: 'Code Reviews' })

    await useBugReportStore.getState().finishInBrowser(REPORT)

    expect(useBugReportStore.getState().phase).toEqual({
      name: 'failed',
      error: 'VALIDATION_ERROR',
      message: 'Bad file',
    })
  })
})
