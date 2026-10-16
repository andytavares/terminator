import { EventEmitter } from 'node:events'
import type { MessagePort } from 'node:worker_threads'
import type { FramePort } from '../../src/main/extensions/frame-bridge.js'

interface NodeMessagePortEvents {
  on(event: 'message', listener: (data: unknown) => void): unknown
  once(event: 'close', listener: () => void): unknown
}

/** A Node worker_threads MessagePort as the FramePort main speaks to: message events carry the
 * payload in `data`, like MessagePortMain's. */
export function nodePortAsFramePort(port: MessagePort): FramePort {
  const node = port as unknown as NodeMessagePortEvents
  const events = new EventEmitter()
  node.on('message', (data) => events.emit('message', { data }))
  node.once('close', () => events.emit('close'))
  // Node reports a close on a later turn; this fires it now for specs that cannot wait.
  const dropForTest = () => events.emit('close')
  port.start()
  return {
    postMessage: (message) => port.postMessage(message),
    on: (event, listener) => void events.on(event, listener as (...args: unknown[]) => void),
    once: (event, listener) => void events.once(event, listener as (...args: unknown[]) => void),
    start: () => port.start(),
    close: () => port.close(),
    dropForTest,
  } as FramePort & { dropForTest(): void }
}
