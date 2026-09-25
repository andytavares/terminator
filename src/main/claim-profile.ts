import { app } from 'electron'
import { claimProfile } from './profile-lock.js'

// Must be index.ts's first import: electron-store instances resolve userData
// when their modules load.
if (!claimProfile(app)) {
  app.exit(0)
}
