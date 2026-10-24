import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FilesystemHandlerContext } from './filesystem-handler-context'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  readMediaPreview: vi.fn(),
  assertSupported: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, fn: (...args: unknown[]) => unknown) => mocks.handlers.set(name, fn)
  }
}))
vi.mock('./filesystem-chunk-read-handler', () => ({ registerFilesystemChunkReadHandler: vi.fn() }))
vi.mock('../../media/media-preview-protocol', () => ({ readMediaPreview: mocks.readMediaPreview }))
vi.mock('../../media/media-preview-remote-reader', () => ({
  UPDATE_REQUIRED_MESSAGE: 'update required',
  assertRemoteMediaReadSupported: mocks.assertSupported
}))

import { registerFilesystemReadHandlers } from './filesystem-read-handlers'

const sender = { id: 1, once: vi.fn(), removeListener: vi.fn() }
const event = { sender }
const args = {
  environmentId: 'env-1',
  worktree: 'id:wt-1',
  relativePath: 'out/clip.mp4',
  expectedEnvironmentPairingRevision: 4
}
const media = {
  content: '',
  isBinary: true,
  mimeType: 'video/mp4',
  mediaUrl: 'orca-media://file/t'
}

function invoke(input: unknown): Promise<unknown> {
  const handler = mocks.handlers.get('fs:readRuntimeMediaPreview')
  if (!handler) {
    throw new Error('handler not registered')
  }
  return Promise.resolve(handler(event, input))
}

describe('fs:readRuntimeMediaPreview', () => {
  const store = {}
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.readMediaPreview.mockReset().mockReturnValue(media)
    mocks.assertSupported.mockReset().mockResolvedValue(undefined)
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: registration only forwards these members and the mocked handlers never read them.
    registerFilesystemReadHandlers({ store } as unknown as FilesystemHandlerContext)
  })

  it('mints a grant from an explicitly built address', async () => {
    await expect(invoke({ ...args, extra: 'ignored' })).resolves.toBe(media)
    expect(mocks.readMediaPreview).toHaveBeenCalledWith(event, { remote: args }, store)
  })

  it('rejects with the update message and mints nothing', async () => {
    mocks.assertSupported.mockRejectedValue(new Error('update required'))
    await expect(invoke(args)).rejects.toThrow('update required')
    expect(mocks.readMediaPreview).not.toHaveBeenCalled()
  })

  it('still mints when the probe fails for another reason', async () => {
    mocks.assertSupported.mockRejectedValue(new Error('offline'))
    await expect(invoke(args)).resolves.toBe(media)
    expect(mocks.readMediaPreview).toHaveBeenCalledOnce()
  })

  it.each([1.5, Number.NaN, '4'])('rejects pairing revision %s', async (revision) => {
    await expect(invoke({ ...args, expectedEnvironmentPairingRevision: revision })).rejects.toThrow(
      'Invalid media path'
    )
  })

  it('accepts an absent pairing revision', async () => {
    await expect(invoke({ ...args, expectedEnvironmentPairingRevision: undefined })).resolves.toBe(
      media
    )
  })

  it('rejects an absolute path', async () => {
    await expect(invoke({ ...args, relativePath: '/etc/a.mp4' })).rejects.toThrow(
      'Invalid media path'
    )
  })
})
