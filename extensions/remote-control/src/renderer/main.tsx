import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import '@terminator/extension-ui/fonts'
import '@terminator/extension-ui/settings-fields.css'
import { App } from './App'

mountExtension(<App />)
