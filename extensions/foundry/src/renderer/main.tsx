import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import { installIconTooltips } from '@terminator/extension-ui'
import '@terminator/extension-ui/fonts'
import '../components/foundry.css'
import { App } from './App'

installIconTooltips()
mountExtension(<App />)
