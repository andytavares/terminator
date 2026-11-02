import '@terminator/extension-ui/fonts'
import '@terminator/extension-ui/tokens.css'
import './mobile.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MobileApp } from './MobileApp'

const root = document.getElementById('root')!
createRoot(root).render(<MobileApp />)
