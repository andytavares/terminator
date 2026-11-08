// Mutation testing (ADR 150): `npm run test:mutation`. A surviving mutant is a change to the code
// that no test notices. The modules are the ones whose tests the test audit deleted or merged most.
export default {
  testRunner: 'vitest',
  // forks, as Vitest runs here: worker threads reject vitest.config.ts's --harmony-temporal.
  vitest: { configFile: 'vitest.config.ts', related: true, pool: 'forks' },
  mutate: [
    'extensions/foundry/src/gates/autonomy.ts',
    'extensions/foundry/src/ledger/curator.ts',
    'extensions/foundry/src/verify/ladder.ts',
    'src/shared/session-records/retention.ts',
    'extensions/git-integration/src/github/pr-review-service.ts',
  ],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress'],
  tempDirName: '.stryker-tmp',
}
