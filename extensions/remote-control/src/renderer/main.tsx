import React from 'react'
import { mountExtension } from '@terminator/extension-sdk/renderer'
import '@terminator/extension-ui/fonts'
import './styles.css'
import { App } from './App'

mountExtension(<App />)
