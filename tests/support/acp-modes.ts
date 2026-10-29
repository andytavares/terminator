import { SessionModeManager } from '@agentclientprotocol/claude-agent-acp/dist/session-mode.js'

type ModeOffer = { buildAvailableModes(allowBypass: boolean): Array<{ id: string }> }

/** The permission modes the real Claude ACP adapter offers a session (no bypass). */
export function availableAdapterModes(): string[] {
  // `buildAvailableModes` is private in the adapter's types; it is the one place the list lives.
  const manager = new SessionModeManager({
    airClient: () => false,
  } as never) as unknown as ModeOffer
  return manager.buildAvailableModes(false).map((mode) => mode.id)
}
