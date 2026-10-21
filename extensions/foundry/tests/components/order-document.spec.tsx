import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { createChangeBus } from '../helpers/change-bus.js'
import { Orders } from '../../src/components/Orders.js'
import { Floor } from '../../src/components/Floor.js'
import { FactorySite } from '../../src/components/factory/FactorySite.js'
import type { DocumentLink } from '../../src/line/document-outcome.js'

// A research order ends on a document. Every surface that names the order is
// one click from it: a link for something published, the file itself otherwise.

const ARTIFACT: DocumentLink = {
  kind: 'claude-artifact',
  url: 'https://claude.ai/artifact/abc-123',
  path: '/out/research.md',
}
const FILE: DocumentLink = { kind: 'file', url: null, path: '/out/notes/findings.md' }

let openExternal: ReturnType<typeof vi.fn>
let openPath: ReturnType<typeof vi.fn>
let writeText: ReturnType<typeof vi.fn>
const bus = createChangeBus()

function install(invoke: (channel: string) => unknown): void {
  Object.assign(window, {
    electronAPI: {
      extensionBridge: { invoke: vi.fn(async (c: string) => invoke(c)), on: bus.on },
      shell: { openExternal, openPath },
      extension: { runCommand: vi.fn(), hasCommand: vi.fn(async () => true) },
    },
  })
}

beforeEach(() => {
  openExternal = vi.fn(async () => ({ ok: true }))
  openPath = vi.fn(async () => ({ ok: true }))
  writeText = vi.fn(async () => undefined)
  Object.assign(navigator, { clipboard: { writeText } })
})

const listRow = (over: Record<string, unknown>) => ({
  id: 'WO-1',
  title: 'Research the cache',
  status: 'done',
  risk: 'P2',
  failures: 0,
  source: { kind: 'typed', tracker: null, key: null },
  openQuestions: 0,
  ...over,
})

describe('the order list', () => {
  it('links a published document by its address, outside the application', async () => {
    install(() => ({ orders: [listRow({ document: ARTIFACT })] }))
    render(<Orders repoRoot="/repo" />)
    const link = await screen.findByRole('link', { name: 'Claude artifact' })
    expect(link.getAttribute('href')).toBe(ARTIFACT.url)
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith(ARTIFACT.url)
  })

  it('names a file by its base name and opens it with the system', async () => {
    install(() => ({ orders: [listRow({ document: FILE })] }))
    render(<Orders repoRoot="/repo" />)
    fireEvent.click(await screen.findByRole('link', { name: 'findings.md' }))
    expect(openPath).toHaveBeenCalledWith(FILE.path)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('shows no link for an order without a document', async () => {
    install(() => ({ orders: [listRow({ document: null })] }))
    render(<Orders repoRoot="/repo" />)
    await screen.findByText('Research the cache')
    expect(screen.queryByRole('link')).toBeNull()
  })
})

const DONE = {
  kind: 'done',
  turn: 'foundry',
  label: 'done',
  headline: 'Done',
  detail: 'All finished.',
  done: 1,
  total: 1,
  gateId: null,
}
const RUNNING = { ...DONE, kind: 'running', headline: 'Running', done: 0 }

function mountFloor(standing: unknown, document: DocumentLink | null): void {
  install((channel) =>
    channel === 'foundry:run.observe'
      ? {
          graph: { orderId: 'WO-1', recipe: 'research', nodes: [] },
          ready: [],
          blocked: [],
          standing,
          document,
        }
      : { pending: [], firings: [], entries: [], mutes: [], lines: [] }
  )
  render(<Floor orderId="WO-1" />)
}

describe('the open order', () => {
  it('offers the artifact, its local copy and its link once the order is done', async () => {
    mountFloor(DONE, ARTIFACT)
    fireEvent.click(await screen.findByRole('button', { name: 'Open artifact' }))
    expect(openExternal).toHaveBeenCalledWith(ARTIFACT.url)
    fireEvent.click(screen.getByRole('button', { name: 'Open local copy' }))
    expect(openPath).toHaveBeenCalledWith(ARTIFACT.path)
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(ARTIFACT.url)
  })

  it('offers a file once, with no copy of a link it does not have', async () => {
    mountFloor(DONE, FILE)
    fireEvent.click(await screen.findByRole('button', { name: 'Open document' }))
    expect(openPath).toHaveBeenCalledWith(FILE.path)
    expect(screen.queryByRole('button', { name: 'Open local copy' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
  })

  it('still links the document before the order is done, without the buttons', async () => {
    mountFloor(RUNNING, ARTIFACT)
    await screen.findByRole('link', { name: 'Claude artifact' })
    expect(screen.queryByRole('button', { name: 'Open artifact' })).toBeNull()
  })

  it('survives a refused clipboard', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    mountFloor(DONE, ARTIFACT)
    fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
  })
})

describe('the factory site card', () => {
  it('puts the document link beside the card button, not inside it', async () => {
    install((channel) =>
      channel === 'foundry:order.list'
        ? { orders: [listRow({ document: ARTIFACT })] }
        : channel === 'foundry:signals.list'
          ? { signals: [], counts: { open: 0 } }
          : channel === 'foundry:sensors.list'
            ? { sensors: [] }
            : { orders: [] }
    )
    const onOpen = vi.fn()
    render(<FactorySite repoRoot="/repo" onOpen={onOpen} />)
    const link = await screen.findByRole('link', { name: 'Claude artifact' })
    expect(link.closest('button')).toBeNull()
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith(ARTIFACT.url)
    expect(onOpen).not.toHaveBeenCalled()
  })
})
