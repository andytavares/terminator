import '@fontsource/ibm-plex-mono/300.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import './mobile.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MobileApp } from './MobileApp'

const root = document.getElementById('root')!
createRoot(root).render(<MobileApp />)
