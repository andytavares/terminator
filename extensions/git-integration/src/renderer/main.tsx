import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import { installIconTooltips } from '@terminator/extension-ui'
import '@terminator/extension-ui/fonts'
// Before App, so every view's own stylesheet comes after the rules they share.
import '../components/shared-chrome.css'
import { App } from './App'
import '../components/syntax-theme.css'
import '../components/git-integration.css'

installIconTooltips()
mountExtension(<App />)
