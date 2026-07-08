import { describe, it, expect } from 'vitest'
import { REMOTE_ACCESSIBLE_CHANNELS } from '../remote-accessible-channels'

// The remote surface is derived from the channel manifest, so the shim and the
// allowlist can no longer half-ship independently — both are generated from
// the same declaration, and the exact expected channel list is pinned as a
// literal in src/shared/electron-api/__tests__/manifest.spec.ts (the reviewable
// gate for widening/shrinking the surface). This spec only asserts hard
// invariants that do NOT re-run the derivation, to stay non-circular.

describe('REMOTE_ACCESSIBLE_CHANNELS', () => {
  it('is non-empty and includes the load-bearing terminal channels', () => {
    for (const ch of ['terminal:create', 'terminal:input', 'terminal:output', 'shell:exec']) {
      expect(REMOTE_ACCESSIBLE_CHANNELS.has(ch)).toBe(true)
    }
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
      'shell:open-external',
      'menu:set-panel-checked',
    ]) {
      expect(REMOTE_ACCESSIBLE_CHANNELS.has(internal)).toBe(false)
    }
  })
})
