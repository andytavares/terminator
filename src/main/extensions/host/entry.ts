import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import type { MessagePortMain } from 'electron'
import { wrapDb } from '../../db/index.js'
import { RpcEndpoint, type MessageLink, type RpcMessage } from './rpc-endpoint.js'
import { HostRuntime } from './host-runtime.js'
import { requireLoader } from './backend-loader.js'
import type { HostSnapshot } from './snapshot.js'

// The extension host: a utilityProcess main starts for every extension backend (ADR 094).
const loadCommonJs = createRequire(import.meta.url)

function portLink(port: MessagePortMain): MessageLink {
  return {
    post: (message) => port.postMessage(message),
    listen: (receive) => port.on('message', (event) => receive(event.data as RpcMessage)),
  }
}

/** The extensions' own connection to the app database; WAL lets main keep its own. */
function openDatabase(path: string) {
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: true })
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA busy_timeout = 5000')
  return wrapDb(database)
}

process.parentPort.once('message', (event) => {
  const [port] = event.ports
  const snapshot = event.data as HostSnapshot
  const endpoint = new RpcEndpoint(portLink(port), (method, error) =>
    console.error(`[extension-host] ${method} failed:`, error)
  )
  new HostRuntime(endpoint, {
    snapshot,
    db: openDatabase(snapshot.databasePath),
    loader: requireLoader(loadCommonJs),
  })
  port.start()
})
