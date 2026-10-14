import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import { installIconTooltips } from '@terminator/extension-ui'
import '@terminator/extension-ui/fonts'
import { App } from './App'
import '../components/task-vault.css'

installIconTooltips()
mountExtension(<App />)
