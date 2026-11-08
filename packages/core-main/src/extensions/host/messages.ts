import type { CommandContext, CommandContribution } from '@terminator/extension-sdk'

// What crosses the extension host's port between one extension's API and main
// (ADR 094), as one record per message.

/** A call to the API member at `path`; a registration also names the handle main keeps. */
export interface ApiCall {
  extensionId: string
  path: string
  params: unknown[]
  handleId?: number
}

/** A registration main keeps under the handle the extension host chose. */
export interface HeldRegistration<Params extends unknown[]> {
  extensionId: string
  handleId: number
  params: Params
}

/** `ipc.registerHandler`: the channel, and whether a remote client may call it. */
export type ChannelRegistration = HeldRegistration<[channel: string, remote: boolean]>

/** `commands.register`: the command without its schema, and whether it takes args. */
export type CommandRegistration = HeldRegistration<
  [command: CommandContribution, takesArgs: boolean]
>

/** Main running one of an extension's commands in the extension host. */
export interface CommandRun {
  extensionId: string
  commandId: string
  context: CommandContext
  args: unknown
}
