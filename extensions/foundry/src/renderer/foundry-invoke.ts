import { invoke } from '@terminator/extension-sdk/renderer'
import type { FoundryApi } from '../ipc/foundry-api.js'

/** The arguments a channel takes after its name: none when its payload is `undefined`. */
type PayloadArgs<K extends keyof FoundryApi> = undefined extends FoundryApi[K]['payload']
  ? [payload?: FoundryApi[K]['payload']]
  : [payload: FoundryApi[K]['payload']]

/** The message of a refused move: its `error`, or an `actionError` that came after it was accepted. */
export function refusalOf(answer: object): string | null {
  if ('error' in answer && typeof answer.error === 'string') return answer.error
  if ('actionError' in answer && typeof answer.actionError === 'string') return answer.actionError
  return null
}

/** `invoke` for a Foundry channel: the payload and the answer are the handler's own types. */
export function foundryInvoke<K extends keyof FoundryApi>(
  channel: K,
  ...payload: PayloadArgs<K>
): Promise<FoundryApi[K]['answer']> {
  return invoke(channel, ...payload) as Promise<FoundryApi[K]['answer']>
}
