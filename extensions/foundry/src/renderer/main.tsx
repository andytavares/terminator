import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import '@terminator/extension-ui/fonts'
import '../components/foundry.css'
import { App } from './App'

mountExtension(<App />)
