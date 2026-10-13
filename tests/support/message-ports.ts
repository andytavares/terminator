import type { MessagePort } from 'node:worker_threads'
import type { MessageLink } from '../../src/main/extensions/host/rpc-endpoint'

/** A MessageLink over one end of a MessageChannel, kept in `ports` for the spec to close. */
export function workerPortLink(port: MessagePort, ports: MessagePort[]): MessageLink {
  ports.push(port)
  return {
    post: (message) => port.postMessage(message),
    listen: (receive) => port.on('message', receive),
  }
}
