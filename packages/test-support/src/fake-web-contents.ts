import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { partialFake } from './fakes'

type Listener = (...args: never[]) => void

/** A WebContents as handlers know one: what it was sent, and the ways it can go away. */
export function fakeWebContentsView<TEvent = unknown>() {
  const received: TEvent[] = []
  let destroyed = false
  const events = new EventEmitter()
  const calling = (listener: Listener) => (details: unknown) => listener(details as never)
  const sender: WebContents = partialFake<WebContents>({
    send: (_channel: string, event: TEvent) => void received.push(event),
    isDestroyed: () => destroyed,
    once: (name: string, listener: Listener) => (events.once(name, calling(listener)), sender),
    on: (name: string, listener: Listener) => (events.on(name, calling(listener)), sender),
  })
  const destroy = () => {
    destroyed = true
    events.emit('destroyed')
  }
  const navigate = (navigation: { isMainFrame: boolean; isSameDocument: boolean }) =>
    events.emit('did-start-navigation', navigation)
  return { sender, received, destroy, navigate }
}
