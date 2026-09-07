import { defineConfig } from 'vitest/config'

// The live specs, which the default run excludes on purpose.
//
// They drive the real `git` and `gh` binaries against a real remote, so they
// need `gh` authenticated and a checkout to work in. Left in the default suite
// they would report "skipped", and a skip inside a green run is a check nobody
// notices is missing.
//
//   FOUNDRY_LIVE_REPO=/path/to/checkout npm run test:live
export default defineConfig({
  test: {
    name: 'live',
    environment: 'node',
    include: ['extensions/*/tests/live/**/*.spec.ts'],
    // One at a time: they push branches and open pull requests on the same
    // remote, and two of them racing would interleave those.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
  },
})
