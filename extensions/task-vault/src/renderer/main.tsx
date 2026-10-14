import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import '@terminator/extension-ui/fonts'
import { App } from './App'
import '../components/task-vault.css'

mountExtension(<App />)
