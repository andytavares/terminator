import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { installNotepadBridge, eventually } from './helpers/note-surface'
import type { DiagramComment, DiagramListItem } from '../../src/db/types'

const APP_STATE = {
  scrollX: 10,
  scrollY: 20,
  zoom: { value: 2 },
  offsetLeft: 0,
  offsetTop: 0,
  width: 800,
  height: 600,
}

/** The canvas the view mounted: what it was given, so a test can draw on it. */
const canvas = vi.hoisted(() => ({
  onChange: null as null | ((elements: unknown[], state: unknown) => void),
  initialData: null as unknown,
}))

vi.mock('@excalidraw/excalidraw', async () => {
  const { useEffect } = await import('react')
  function Excalidraw(props: {
    onChange: (elements: unknown[], state: unknown) => void
    excalidrawAPI: (api: unknown) => void
    initialData: unknown
  }) {
    canvas.onChange = props.onChange
    canvas.initialData = props.initialData
    useEffect(() => {
      props.excalidrawAPI({ getAppState: () => APP_STATE, getSceneElements: () => [] })
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="excalidraw" />
  }
  return { Excalidraw }
})

const bridge = installNotepadBridge()

import { DiagramView } from '../../src/components/DiagramView'
import { useNotesStore } from '../../src/stores/notes.store'

const SCENE = JSON.stringify({ elements: [{ id: 'e1' }], appState: { scrollX: 1 } })

function pin(id: string, body: string, replies: DiagramComment[] = []): DiagramComment {
  return {
    id,
    diagramId: 'd1',
    parentId: null,
    body,
    author: 'me',
    status: 'open',
    sceneX: 5,
    sceneY: 6,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    replies,
  }
}

const LISTED: DiagramListItem = {
  id: 'd1',
  title: 'Listed title',
  tags: ['listed'],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  archivedAt: null,
  type: 'diagram',
  sortOrder: 0,
  folderId: null,
}

beforeEach(() => {
  for (const key of Object.keys(bridge.responses)) delete bridge.responses[key]
  bridge.invoke.mockClear()
  canvas.onChange = null
  useNotesStore.setState({ diagrams: [LISTED], diagramCache: {} })
})

afterEach(cleanup)

async function openDiagram(comments: DiagramComment[] = []) {
  bridge.responses['terminator.notepad:diagrams.get'] = {
    data: { title: 'Flow', tags: ['arch'], sceneJson: SCENE },
  }
  bridge.responses['terminator.notepad:diagram-comments.list'] = { data: comments }
  const view = render(<DiagramView diagramId="d1" />)
  await eventually(() => expect(screen.getByTestId('excalidraw')).toBeTruthy())
  return view
}

describe('DiagramView loading', () => {
  it('opens the diagram with its title, tags and scene, and caches the scene', async () => {
    await openDiagram()
    expect(screen.getByText('Flow')).toBeTruthy()
    expect(screen.getByText('#arch')).toBeTruthy()
    expect(canvas.initialData).toEqual({
      elements: [{ id: 'e1' }],
      appState: { scrollX: 1 },
      scrollToContent: true,
    })
    expect(useNotesStore.getState().diagramCache.d1).toBe(SCENE)
  })

  it('opens from the session cache, titled from the diagram list', async () => {
    useNotesStore.setState({ diagramCache: { d1: SCENE } })
    render(<DiagramView diagramId="d1" />)
    await eventually(() => expect(screen.getByText('Listed title')).toBeTruthy())
    expect(bridge.calls('terminator.notepad:diagrams.get')).toEqual([])
  })

  it('says so when the diagram does not exist', async () => {
    bridge.responses['terminator.notepad:diagrams.get'] = { data: null }
    render(<DiagramView diagramId="d1" />)
    await eventually(() => expect(screen.getByText('Diagram not found.')).toBeTruthy())
  })
})

describe('DiagramView saving', diagramViewSavingTests)
describe('DiagramView comments', diagramViewCommentsTests)

function diagramViewSavingTests() {
  describe('autosave', diagramViewSavingAutosaveTests)
  describe('renaming', diagramViewSavingRenamingTests)
}

function diagramViewSavingAutosaveTests() {
  it('autosaves a drawing after a pause, and keeps the list and cache in step', async () => {
    await openDiagram()
    act(() => canvas.onChange?.([{ id: 'e2' }], APP_STATE))
    const sceneJson = JSON.stringify({
      elements: [{ id: 'e2' }],
      appState: { scrollX: 10, scrollY: 20, zoom: { value: 2 } },
    })
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:diagrams.autosave')).toEqual([
        { id: 'd1', title: 'Flow', sceneJson, tags: ['arch'] },
      ])
    )
    await eventually(() => expect(useNotesStore.getState().diagramCache.d1).toBe(sceneJson))
    expect(useNotesStore.getState().diagrams[0]).toMatchObject({ title: 'Flow', tags: ['arch'] })
  })

  it('flushes a drawing not yet saved when the diagram is closed', async () => {
    const view = await openDiagram()
    act(() => canvas.onChange?.([{ id: 'e3' }], APP_STATE))
    view.unmount()
    expect(bridge.calls('terminator.notepad:diagrams.autosave')).toEqual([
      expect.objectContaining({ id: 'd1', title: 'Flow', tags: ['arch'] }),
    ])
    expect(useNotesStore.getState().diagramCache.d1).toContain('e3')
  })
}

function diagramViewSavingRenamingTests() {
  it('renames the diagram', async () => {
    await openDiagram()
    fireEvent.click(screen.getByTitle('Click to rename'))
    const input = screen.getByDisplayValue('Flow')
    fireEvent.change(input, { target: { value: '  Plan  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await eventually(() =>
      expect(bridge.calls('terminator.notepad:diagrams.autosave')).toContainEqual({
        id: 'd1',
        title: 'Plan',
        tags: ['arch'],
      })
    )
    expect(screen.getByText('Plan')).toBeTruthy()
  })
}

function diagramViewCommentsTests() {
  describe('placing', diagramViewCommentsPlacingTests)
  describe('thread actions', diagramViewCommentsThreadActionsTests)
}

function diagramViewCommentsPlacingTests() {
  it('places a comment where the canvas is clicked, in scene coordinates', async () => {
    await openDiagram()
    fireEvent.click(screen.getByRole('button', { name: /comment/i }))
    const intercept = document.querySelector('.diagram-view__comment-intercept')!
    fireEvent.click(intercept, { clientX: 100, clientY: 60 })
    bridge.responses['terminator.notepad:diagram-comments.list'] = { data: [pin('p1', 'Look')] }
    fireEvent.change(screen.getByPlaceholderText('Add a comment…'), { target: { value: 'Look' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() => expect(screen.getByLabelText('Comment: Look')).toBeTruthy())
    expect(bridge.calls('terminator.notepad:diagram-comments.create')).toEqual([
      { diagramId: 'd1', body: 'Look', sceneX: 40, sceneY: 10 },
    ])
  })
}

function diagramViewCommentsThreadActionsTests() {
  it('opens a pin to reply to it, and resolving it removes the pin', async () => {
    await openDiagram([pin('p1', 'Look')])
    await eventually(() => expect(screen.getByLabelText('Comment: Look')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Comment: Look'))
    const reply = { ...pin('r1', 'Agreed'), parentId: 'p1' }
    bridge.responses['terminator.notepad:diagram-comments.list'] = {
      data: [pin('p1', 'Look', [reply])],
    }
    fireEvent.change(screen.getByPlaceholderText('Reply…'), { target: { value: 'Agreed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    // The thread is re-read after a reply, so the reply shows once it is stored.
    await eventually(() => expect(screen.getByText('Agreed')).toBeTruthy())
    expect(bridge.calls('terminator.notepad:diagram-comments.create')).toEqual([
      { diagramId: 'd1', parentId: 'p1', body: 'Agreed', sceneX: 0, sceneY: 0 },
    ])
    fireEvent.click(screen.getByLabelText('Resolve thread'))
    await eventually(() => expect(screen.queryByLabelText('Comment: Look')).toBeNull())
    expect(bridge.calls('terminator.notepad:diagram-comments.resolve')).toEqual([{ id: 'p1' }])
  })

  it('deletes a thread', async () => {
    await openDiagram([pin('p1', 'Look')])
    await eventually(() => expect(screen.getByLabelText('Comment: Look')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Comment: Look'))
    fireEvent.click(screen.getByLabelText('Delete thread'))
    await eventually(() => expect(screen.queryByLabelText('Comment: Look')).toBeNull())
    expect(bridge.calls('terminator.notepad:diagram-comments.delete')).toEqual([{ id: 'p1' }])
  })
}
