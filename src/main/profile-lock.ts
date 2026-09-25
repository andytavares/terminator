import type { App } from 'electron'

export type ProfileApp = Pick<
  App,
  'isPackaged' | 'getPath' | 'setPath' | 'requestSingleInstanceLock'
> & {
  commandLine: Pick<App['commandLine'], 'hasSwitch'>
}

// PGlite is single-user Postgres with no cross-process locking: two processes
// on one app.pglite overwrite each other's catalog pages. Only one process may
// own a profile, and a dev run must not share the installed app's profile.
// The single-instance lock lives in userData, so the dev path is set first.
export function claimProfile(app: ProfileApp): boolean {
  if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', `${app.getPath('userData')}-dev`)
  }
  return app.requestSingleInstanceLock()
}
