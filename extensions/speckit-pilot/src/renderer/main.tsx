import React from 'react'
import { createRoot } from 'react-dom/client'
import '../components/speckit-pilot.css'
import { App } from './App'

const el = document.getElementById('app')
if (!el) throw new Error('No #app element')
createRoot(el).render(<App />)
