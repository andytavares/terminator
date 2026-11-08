import net from 'node:net'

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?|\[?::\]?|0\.0\.0\.0)$/i

type ConnectArguments = unknown[]

/** The host a `socket.connect(...)` call names, or null for a Unix socket or pipe path. */
function hostOf(args: ConnectArguments): string | null {
  // net.connect hands the socket its arguments already normalised, as one array.
  const [first, second] = Array.isArray(args[0]) ? args[0] : args
  if (typeof first === 'object' && first !== null) {
    const options = first as { host?: string; path?: string }
    return options.path === undefined ? (options.host ?? 'localhost') : null
  }
  if (typeof first === 'string' && Number.isNaN(Number(first))) return null
  return typeof second === 'string' ? second : 'localhost'
}

/** Throws unless a `connect` call with these arguments stays on this machine. */
export function assertLoopback(args: ConnectArguments): void {
  const host = hostOf(args)
  if (host !== null && !LOOPBACK.test(host)) {
    throw new Error(`A spec may only connect to localhost: ${host}`)
  }
}

/** Throws unless a `connect` call with these arguments is a Unix socket or pipe: a unit test opens
 * no TCP socket at all, loopback included. */
export function assertNoTcp(args: ConnectArguments): void {
  const host = hostOf(args)
  if (host !== null) throw new Error(`A unit test may open no TCP socket (T-BOUNDARY): ${host}`)
}

/** Makes TCP and TLS connections (net.connect, tls.connect, http, fetch's agents all end in
 * net.Socket.prototype.connect) throw: every one in a unit test, any to another machine in an
 * integration test. Returns what restores it. */
export function installNetworkGuard(tier: 'unit' | 'integration'): () => void {
  const original = net.Socket.prototype.connect
  const check = tier === 'unit' ? assertNoTcp : assertLoopback
  net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
    check(args)
    return (original as (...rest: unknown[]) => net.Socket).apply(this, args)
  } as typeof net.Socket.prototype.connect
  return () => {
    net.Socket.prototype.connect = original
  }
}
