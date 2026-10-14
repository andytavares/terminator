/** What a view sent over the extension bridge, read from the `invoke` mock a spec installed. */
interface InvokeMock {
  mock: { calls: ReadonlyArray<readonly unknown[]> }
}

/** The payloads `invoke` was called with on `channel`, oldest first. */
export function payloadsSentOn(invoke: InvokeMock, channel: string): unknown[] {
  return invoke.mock.calls.filter(([sent]) => sent === channel).map(([, payload]) => payload)
}

/** How many times `invoke` was called on `channel`. */
export function timesInvoked(invoke: InvokeMock, channel: string): number {
  return payloadsSentOn(invoke, channel).length
}
