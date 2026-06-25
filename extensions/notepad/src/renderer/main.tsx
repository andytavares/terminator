import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '../components/notepad.css'

const el = document.getElementById('app')
if (!el) throw new Error('No #app element')
createRoot(el).render(<App />)
