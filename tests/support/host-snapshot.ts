import type { HostSnapshot } from '../../src/main/extensions/host/snapshot'

/** What main hands the extension host at start: an in-memory database and no workspace. */
export function hostSnapshot(overrides: Partial<HostSnapshot> = {}): HostSnapshot {
  return {
    databasePath: ':memory:',
    paths: { app: '/app', userData: '/data' },
    settings: {},
    workspaces: { workspaces: [], projects: {} },
    trackers: {
      linear: { transitions: true, create: true },
      jira: { transitions: true, create: false },
    },
    ...overrides,
  }
}
