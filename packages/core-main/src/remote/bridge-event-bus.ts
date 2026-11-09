import { EventEmitter } from 'events'

export const bridgeEventBus = new EventEmitter()
bridgeEventBus.setMaxListeners(200)
