import { describe, it, expect } from 'vitest'
import { REMOTE_ACCESSIBLE_CHANNELS } from '../remote-accessible-channels'
import { ELECTRON_API_MANIFEST } from '../../../shared/electron-api/manifest'

// The remote surface is derived from the channel manifest, so the shim and the
// allowlist can no longer half-ship independently: both are generated from the
// same declaration. The exact expected channel list is pinned in
// src/shared/electron-api/__tests__/manifest.spec.ts; this spec checks the
// derivation contract from the bridge's point of view.

describe('REMOTE_ACCESSIBLE_CHANNELS', () => {
  it('covers every channel the generated remote shim can reach (no silent /app/ breakage)', () => {
    const shimChannels = ELECTRON_API_MANIFEST.filter(
      (s) => s.kind !== 'local' && (s.remote ?? 'same') === 'same'
    ).map((s) => s.channel!)
    expect(shimChannels.length).toBeGreaterThan(0)
    const missing = shimChannels.filter((ch) => !REMOTE_ACCESSIBLE_CHANNELS.has(ch))
    expect(missing).toEqual([])
  })

  it('does NOT expose internal-only channels to the bridge (default-deny holds)', () => {
    // These are deliberately never reachable from the browser bridge.
    for (const internal of [
      'dialog:open-directory',
      'remote:toggle',
      'remote:update-password',
      'db:health',
      'workspace:get-active',
      'extension:update-panel-bounds',
      'extension:set-bottom-inset',
    ]) {
      expect(REMOTE_ACCESSIBLE_CHANNELS.has(internal)).toBe(false)
    }
  })

  it('does not expose channels for stubbed or omitted manifest methods', () => {
    for (const spec of ELECTRON_API_MANIFEST) {
      if (spec.kind === 'local' || !spec.channel) continue
      if ((spec.remote ?? 'same') !== 'same') {
        expect(
          REMOTE_ACCESSIBLE_CHANNELS.has(spec.channel),
          `${spec.channel} is '${spec.remote}' and must not be remote-accessible`
        ).toBe(false)
      }
    }
  })
})
