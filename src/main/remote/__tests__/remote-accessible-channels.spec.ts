import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { REMOTE_ACCESSIBLE_CHANNELS } from '../remote-accessible-channels'

// The browser `/app/` surface routes every electronAPI call through the shim as a
// bridge invoke/send/subscribe. If the shim uses a channel the bridge does not
// allowlist, that call is silently rejected and `/app/` breaks for that feature.
// This test makes the allowlist and the shim fail together, so the security
// mechanism can never half-ship without its allowlist again (the original defect).
const SHIM_PATH = fileURLToPath(
  new URL('../../../renderer-remote/electron-api-shim.ts', import.meta.url)
)

function channelsUsedByShim(): Set<string> {
  const src = readFileSync(SHIM_PATH, 'utf8')
  const channels = new Set<string>()
  // invoke('channel'...), fire('channel'...), on('channel'...)
  const re = /\b(?:invoke|fire|on)\(\s*'([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) channels.add(m[1])
  return channels
}

describe('REMOTE_ACCESSIBLE_CHANNELS', () => {
  it('covers every channel the /app/ shim actually uses (no silent /app/ breakage)', () => {
    const used = channelsUsedByShim()
    expect(used.size).toBeGreaterThan(0) // guard against a regex that matched nothing
    const missing = [...used].filter((ch) => !REMOTE_ACCESSIBLE_CHANNELS.has(ch))
    expect(missing).toEqual([])
  })

  it('does NOT expose internal-only channels to the bridge (default-deny holds)', () => {
    // These are deliberately never reachable from the browser bridge.
    for (const internal of [
      'dialog:open-directory',
      'remote:toggle',
      'remote:update-password',
      'db:health',
    ]) {
      expect(REMOTE_ACCESSIBLE_CHANNELS.has(internal)).toBe(false)
    }
  })
})
