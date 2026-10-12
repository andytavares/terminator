import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import '@terminator/extension-ui/fonts'
import { App } from './App'
import '../components/syntax-theme.css'
import '../components/git-integration.css'

mountExtension(<App />)
