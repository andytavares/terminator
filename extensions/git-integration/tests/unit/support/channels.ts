import { dispatchChannel, type ChannelSpec } from '@terminator/extension-sdk'

/**
 * Collects the channels a `register*Handlers` function registers and answers
 * an invoke of one as the core does: the payload is parsed before `run`.
 */
export function channelRegistry() {
  const specs = new Map<string, ChannelSpec>()
  return {
    register: (spec: ChannelSpec) => {
      specs.set(spec.channel, spec)
    },
    invoke: (channel: string, payload?: unknown): Promise<unknown> => {
      const spec = specs.get(channel)
      if (!spec) throw new Error(`Handler for "${channel}" not registered`)
      return dispatchChannel(spec, payload)
    },
  }
}
