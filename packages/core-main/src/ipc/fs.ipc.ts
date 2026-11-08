import { z } from 'zod'
import fs from 'node:fs/promises'
import { defineChannel } from '@terminator/extension-sdk'
import {
  registerInvokeTable,
  noPayload,
  defineViewChannel,
  type ViewCaller,
} from './invoke-table.js'
import { fsWatcherService, type FsChangeBatch, type FsChangeListener } from '../fs/fs-watcher.js'

// A view's file watches (ADR 109). The view that asks is the one that is told, named by its
// ViewCaller: a desktop view's WebContents, or an extension frame's port.

const listeners = new WeakMap<ViewCaller, FsChangeListener>()

/** The event a view receives: the one file a burst changed, or null when it changed several. */
function changeEventOf(batch: FsChangeBatch) {
  const filename = batch.filenames.length === 1 ? batch.filenames[0] : null
  return { projectRoot: batch.projectRoot, eventType: batch.eventType, filename }
}

/** The listener every watch of `view` reports to. Made once; the view's watches end with it. */
function listenerOf(view: ViewCaller): FsChangeListener {
  const existing = listeners.get(view)
  if (existing) return existing
  const listener: FsChangeListener = (batch) => view.send('fs:changed', changeEventOf(batch))
  listeners.set(view, listener)
  view.onGone(() => fsWatcherService.unwatch(listener))
  return listener
}

const fsChannels = [
  defineViewChannel({
    channel: 'fs:watch-start',
    schema: z.object({ projectRoot: z.string().min(1) }),
    invalid: { error: 'VALIDATION_ERROR' },
    run: ({ projectRoot }, view) => {
      fsWatcherService.watch(projectRoot, listenerOf(view))
      return { ok: true }
    },
  }),
  defineViewChannel({
    channel: 'fs:watch-stop',
    schema: noPayload,
    invalid: { error: 'VALIDATION_ERROR' },
    run: (_nothing, view) => {
      fsWatcherService.unwatch(listenerOf(view))
      return { ok: true }
    },
  }),
  defineChannel({
    channel: 'fs:read-file',
    schema: z.object({ filePath: z.string().min(1) }),
    invalid: { error: 'VALIDATION_ERROR' },
    run: async ({ filePath }) => ({ content: await fs.readFile(filePath, 'utf-8') }),
    onError: () => ({ error: 'FILE_NOT_FOUND' }),
  }),
]

export function registerFsHandlers(): void {
  registerInvokeTable(fsChannels)
}
