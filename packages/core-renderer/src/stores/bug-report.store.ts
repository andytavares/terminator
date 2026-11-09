import { create } from 'zustand'
import type { ReportFailure, ReportSubmission } from '../../../core-shared/src/bug-report'
import { useToastStore } from './toast.store'
import { useExtensionRegistry } from '../extensions/registry'

// The bug report dialog (ADR 156): open or not, where it was opened from, and how far the report
// has got. Posting lives here, not in the dialog, so closing the dialog does not stop an upload:
// the result then arrives as a toast.

export type ReportPhase =
  | { name: 'editing' }
  | { name: 'posting' }
  | { name: 'posted'; ok: true; number: number; url: string }
  | { name: 'in-browser' }
  | { name: 'failed'; error: ReportFailure['error']; message: string }

interface OpenOptions {
  /** The screen the report is about, in the words the user sees. */
  origin: string
  /** Text to start the description with, such as the error a toast showed. */
  prefill?: string
}

interface BugReportState {
  isOpen: boolean
  origin: string
  prefill: string
  phase: ReportPhase
  openReport(options: OpenOptions): void
  close(): void
  post(report: ReportSubmission): Promise<void>
  finishInBrowser(report: ReportSubmission): Promise<void>
}

interface Labelled {
  label: string
}

/** The registry's tabs, as far as naming the screen goes. */
export interface OriginFacts {
  globalTabs: ReadonlyMap<string, Labelled>
  workspaceTabs: ReadonlyMap<string, Labelled>
  projectTabs: ReadonlyMap<string, Labelled>
  activeGlobalTabId: string | null
  activeWorkspaceTabId: string | null
  activeProjectTabId: string | null
}

/** The screen in front of the user: an app tab covers a repo or branch tab, which covers the
 * terminal. */
export function reportOrigin(facts: OriginFacts): string {
  const shown: Array<[ReadonlyMap<string, Labelled>, string | null]> = [
    [facts.globalTabs, facts.activeGlobalTabId],
    [facts.workspaceTabs, facts.activeWorkspaceTabId],
    [facts.projectTabs, facts.activeProjectTabId],
  ]
  for (const [tabs, id] of shown) {
    const label = id === null ? undefined : tabs.get(id)?.label
    if (label) return label
  }
  return 'Terminal'
}

/** The result of a post that finished after the dialog closed. */
function toastResult(result: ReportPhase): void {
  const { addToast } = useToastStore.getState()
  if (result.name === 'posted') {
    addToast({
      type: 'success',
      message: `Bug report posted as issue #${result.number}`,
      action: {
        label: 'Open',
        onSelect: () => void window.electronAPI.shell.openExternal(result.url),
      },
    })
  } else if (result.name === 'failed') {
    addToast({ type: 'error', message: `Bug report not posted: ${result.message}` })
  }
}

function failed({ error, message }: ReportFailure): ReportPhase {
  return { name: 'failed', error, message }
}

export const useBugReportStore = create<BugReportState>((set, get) => ({
  isOpen: false,
  origin: 'Terminal',
  prefill: '',
  phase: { name: 'editing' },
  openReport: ({ origin, prefill = '' }) =>
    // A report still uploading keeps its phase, so reopening shows it.
    set((s) => ({
      isOpen: true,
      origin,
      prefill,
      phase: s.phase.name === 'posting' ? s.phase : { name: 'editing' },
    })),
  close: () => set({ isOpen: false }),
  post: async (report) => {
    set({ phase: { name: 'posting' } })
    const result = await window.electronAPI.bugReport.submit(report)
    const phase: ReportPhase = result.ok ? { name: 'posted', ...result } : failed(result)
    set({ phase })
    if (!get().isOpen) toastResult(phase)
  },
  finishInBrowser: async (report) => {
    const result = await window.electronAPI.bugReport.openInBrowser(report)
    set({ phase: result.ok ? { name: 'in-browser' } : failed(result) })
  },
}))

/** Opens the report about the screen in front of the user: from the menu, the palette or a toast. */
export function openBugReport(prefill?: string): void {
  const origin = reportOrigin(useExtensionRegistry.getState())
  useBugReportStore.getState().openReport({ origin, prefill })
}
