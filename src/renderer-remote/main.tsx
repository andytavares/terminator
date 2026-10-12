import React from 'react'
import { createRoot } from 'react-dom/client'
import '@terminator/extension-ui/fonts'
import '@terminator/extension-ui/tokens.css'
import '../renderer/styles.css'
import { App } from './App'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<App />)
}
