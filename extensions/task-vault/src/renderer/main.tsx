import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import { App } from './App'
import '../components/task-vault.css'

mountExtension(<App />)
