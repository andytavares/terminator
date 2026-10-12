import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-mono/300.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@terminator/extension-ui/tokens.css'
import '../renderer/styles.css'
import { App } from './App'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<App />)
}
