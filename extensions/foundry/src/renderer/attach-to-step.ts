import { foundryInvoke } from './foundry-invoke.js'

// Attaches to a step's agent and goes to its terminal, as the Floor and the hall
// offer; why not, when it could not.
export async function attachTo(orderId: string, nodeId: string): Promise<string | null> {
  const r = await foundryInvoke('foundry:session.attach', { orderId, nodeId })
  if (r.error !== undefined) return r.error
  // And then actually go there. This resolved the session and dropped it,
  // so the button labelled "Attach" navigated nowhere at all — the one
  // control on a read-only surface, and it did nothing.
  const gone = await foundryInvoke('foundry:run-terminal', {
    sessionId: r.terminalSessionId,
  })
  return gone.ok === true ? null : 'That agent is no longer in an agent tab.'
}
