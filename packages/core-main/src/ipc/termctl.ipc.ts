import { defineChannel, validationError, type ChannelSpec } from '@terminator/extension-sdk'
import { changeChannel, failureOf, noPayload, registerInvokeTable } from './invoke-table.js'
import {
  installTermctl,
  termctlStatus,
  uninstallTermctl,
  type TermctlOptions,
} from '../integrations/termctl-command.js'

// Core-only. Settings › Integrations shows termctl's link in /usr/local/bin and changes it.
// The options resolve once the launcher is written.

function termctlChannels(options: Promise<TermctlOptions>): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'termctl:status',
      schema: noPayload,
      invalid: validationError,
      run: async () => ({ data: await termctlStatus(await options) }),
      onError: failureOf,
    }),
    changeChannel('termctl:install', installTermctl, options),
    changeChannel('termctl:uninstall', uninstallTermctl, options),
  ]
}

export function registerTermctlHandlers(options: Promise<TermctlOptions>): void {
  registerInvokeTable(termctlChannels(options))
}
