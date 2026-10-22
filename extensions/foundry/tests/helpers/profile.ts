import type { ProfileFacts } from '../../src/forge/checks-view.js'

/** The glyph repository's profile as `foundry:profile-read` answers it: five sources, one failing on main. */
export function glyphProfile(over: Partial<ProfileFacts> = {}): ProfileFacts {
  return {
    repository: '/repos/app',
    prepare: { command: './glyph fetch', source: 'operator' },
    share: [],
    checks: {
      test: { command: './glyph test', source: 'scout', evidence: 'README.md' },
      lint: null,
      format: { command: './glyph fmt --check', source: 'repository' },
      coverage: null,
      e2e: null,
      build: { command: 'make', source: 'hint', evidence: 'Makefile' },
    },
    additional: [{ name: 'Type check', command: './glyph check', rung: 'L0', source: 'operator' }],
    pictures: null,
    paths: { interface: [], manifests: [], lockfiles: [], formatting: [] },
    proof: {
      commit: '4be1c09aaaa',
      at: '2026-10-21T10:00:00.000Z',
      exitCodes: {
        './glyph fetch': 0,
        './glyph fmt --check': 1,
        './glyph test': 0,
        make: 0,
        './glyph check': 0,
      },
    },
    ...over,
  }
}

/** A repository nothing could be read from. */
export function bareProfile(): ProfileFacts {
  return glyphProfile({
    prepare: null,
    checks: { test: null, lint: null, format: null, coverage: null, e2e: null, build: null },
    additional: [],
    proof: null,
  })
}
