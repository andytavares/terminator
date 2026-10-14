import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useNotificationFeed } from '../../../../src/renderer/shell/main-events'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { useShownExtensionViews } from '../../../../src/renderer/stores/shown-extension-views.store'
import { installElectronApi, pushedEvent } from '../../../support/electron-api'

type Pushed = Parameters<Parameters<Window['electronAPI']['notifications']['onPush']>[0]>[0]

function pushedToast(source?: string): Pushed {
  return {
    id: 'n-1',
    type: 'info',
    title: 'Moved to backlog: test',
    timestamp: 0,
    source,
    clickable: false,
    targets: ['toast'],
  } as Pushed
}

let push: ReturnType<typeof pushedEvent<[Pushed]>>

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  useShownExtensionViews.setState({ shown: new Map() })
  push = pushedEvent<[Pushed]>()
  installElectronApi({
    notifications: { list: async () => [], onPush: push.addListener },
  })
  renderHook(() => useNotificationFeed())
})

const toastTexts = () => useToastStore.getState().toasts.map((t) => t.message)

describe('useNotificationFeed — who draws an extension toast', () => {
  it('leaves the toast to the extension whose view is on screen', () => {
    useShownExtensionViews.getState().show('terminator.task-vault:main', 'terminator.task-vault')
    push.deliver(pushedToast('terminator.task-vault'))
    expect(toastTexts()).toEqual([])
  })

  it('draws it when that view is not on screen', () => {
    useShownExtensionViews.getState().show('terminator.task-vault:main', 'terminator.task-vault')
    useShownExtensionViews.getState().hide('terminator.task-vault:main')
    push.deliver(pushedToast('terminator.task-vault'))
    expect(toastTexts()).toEqual(['Moved to backlog: test'])
  })

  it("draws another extension's toast, and the core's own", () => {
    useShownExtensionViews.getState().show('terminator.task-vault:main', 'terminator.task-vault')
    push.deliver(pushedToast('terminator.foundry'))
    push.deliver(pushedToast(undefined))
    expect(toastTexts()).toHaveLength(2)
  })
})
