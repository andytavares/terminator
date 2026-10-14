import type { App } from 'electron'

export type ProfileApp = Pick<
  App,
  'isPackaged' | 'getPath' | 'setPath' | 'requestSingleInstanceLock'
> & {
  commandLine: Pick<App['commandLine'], 'hasSwitch'>
}

// One process per profile: the electron-store JSON files are rewritten whole with no cross-process
// lock, so two instances overwrite each other. A dev run gets its own profile, set before the
// single-instance lock, which lives in userData.
export function claimProfile(app: ProfileApp): boolean {
  if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir')) {
    app.setPath('userData', `${app.getPath('userData')}-dev`)
  }
  return app.requestSingleInstanceLock()
}
