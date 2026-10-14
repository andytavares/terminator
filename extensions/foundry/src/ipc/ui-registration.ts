import { noPayload } from '@terminator/extension-sdk'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import { foundryChannel } from './channel.js'
import { ViewPayload } from './payloads.js'

import { disposables, reg } from './register.js'

// Auto-expires so a late manual visit to the Forge doesn't surprise the
// operator with an intake that opened itself for no reason they can see.
let pendingNewOrder = false
let pendingNewOrderTimer: NodeJS.Timeout | null = null

// Anything but 'factory' reads as 'list' — an unset or corrupted setting is
// the same as never having chosen the newer view.
function viewSetting(api: ExtensionAPI): 'list' | 'factory' {
  return api.settings.get<string>('terminator.foundry.view') === 'factory' ? 'factory' : 'list'
}

/** Which view draws the Forge, and an intake asked for before the view existed. */
export function registerViewChannels(api: ExtensionAPI): void {
  reg(
    api,
    foundryChannel('foundry:ui.view', noPayload, () => ({ view: viewSetting(api) })),
    foundryChannel('foundry:ui.set-view', ViewPayload, ({ view }) => {
      api.settings.set('terminator.foundry.view', view)
      api.window.broadcast('foundry:ui.view-changed', { view })
      return { view }
    }),
    // Renderer calls this on mount to pick up an intake request triggered
    // before the main view existed.
    foundryChannel('foundry:ui.consume-pending-new-order', noPayload, () => {
      const pending = pendingNewOrder
      pendingNewOrder = false
      if (pendingNewOrderTimer !== null) {
        clearTimeout(pendingNewOrderTimer)
        pendingNewOrderTimer = null
      }
      return { pending }
    })
  )
}

/** The palette's two fixed commands: a new work order, and the view toggle. */
export function registerCommands(api: ExtensionAPI): void {
  disposables.push(
    api.commands.register(
      {
        id: 'new-order',
        label: 'New work order…',
        category: 'Foundry',
        mnemonic: 'n',
      },
      () => openNewOrder(api)
    )
  )

  disposables.push(
    api.commands.register(
      {
        id: 'toggle-view',
        label: 'Toggle factory view',
        category: 'Foundry',
        mnemonic: 'v',
      },
      () => {
        const next = viewSetting(api) === 'factory' ? 'list' : 'factory'
        api.settings.set('terminator.foundry.view', next)
        api.window.showSelf('main')
        api.window.broadcast('foundry:ui.view-changed', { view: next })
      }
    )
  )
}

function openNewOrder(api: ExtensionAPI): void {
  api.window.showSelf('main')
  // Broadcast to a running view, and set a pending flag for one not yet created, as
  // Notepad's quick-create does; otherwise a command run before the view is dropped.
  api.window.broadcast('foundry:ui.open-new-order', {})
  pendingNewOrder = true
  if (pendingNewOrderTimer !== null) clearTimeout(pendingNewOrderTimer)
  pendingNewOrderTimer = setTimeout(() => {
    pendingNewOrder = false
    pendingNewOrderTimer = null
  }, 5000)
}

export function clearPendingNewOrder(): void {
  if (pendingNewOrderTimer !== null) clearTimeout(pendingNewOrderTimer)
  pendingNewOrderTimer = null
  pendingNewOrder = false
}
