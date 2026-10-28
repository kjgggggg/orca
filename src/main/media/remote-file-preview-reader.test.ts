import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callRuntimeEnvironment } = vi.hoisted(() => ({ callRuntimeEnvironment: vi.fn() }))
vi.mock('../ipc/runtime-environments/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment
}))
vi.mock('../persistence', () => ({ getCanonicalUserDataPath: () => '/user-data' }))

import {
  REMOTE_PREVIEW_UPDATE_REQUIRED_MESSAGE,
  RemotePreviewPairingChangedError,
  readRemotePreviewChunk,
  statRemotePreviewFile
} from './remote-file-preview-reader'

const address = {
  environmentId: 'env-1',
  worktree: 'id:wt-1',
  relativePath: 'out/clip.mp4',
  expectedEnvironmentPairingRevision: 7
}
const ok = (result: unknown) => ({ ok: true, result })
const fail = (code: string, message: string) => ({ ok: false, error: { code, message } })

describe('remote file preview reader', () => {
  const signal = new AbortController().signal
  beforeEach(() => callRuntimeEnvironment.mockReset())

  it('stats the file through its pinned pairing', async () => {
    callRuntimeEnvironment.mockResolvedValue(
      ok({ size: 6, isDirectory: false, mtime: 1, ctime: 2 })
    )
    await expect(statRemotePreviewFile(address, signal)).resolves.toEqual({
      size: 6,
      mtime: 1,
      ctime: 2
    })
    expect(callRuntimeEnvironment).toHaveBeenCalledWith(
      '/user-data',
      'env-1',
      'files.stat',
      { worktree: 'id:wt-1', relativePath: 'out/clip.mp4' },
      15_000,
      7,
      undefined,
      { signal }
    )
  })

  it('refuses a directory', async () => {
    callRuntimeEnvironment.mockResolvedValue(ok({ size: 0, isDirectory: true, mtime: 1 }))
    await expect(statRemotePreviewFile(address, signal)).rejects.toThrow('directory')
  })

  it('decodes a chunk and refuses one whose length disagrees', async () => {
    callRuntimeEnvironment.mockResolvedValueOnce(
      ok({ contentBase64: 'AAECAw==', bytesRead: 4, eof: false })
    )
    await expect(readRemotePreviewChunk(address, 10, 4, signal)).resolves.toEqual(
      new Uint8Array([0, 1, 2, 3])
    )
    callRuntimeEnvironment.mockResolvedValueOnce(
      ok({ contentBase64: 'AAE=', bytesRead: 4, eof: false })
    )
    await expect(readRemotePreviewChunk(address, 0, 4, signal)).rejects.toThrow('corrupted')
  })

  it('tells the user to update a host without range reads', async () => {
    callRuntimeEnvironment.mockResolvedValue(fail('method_not_found', 'x'))
    await expect(statRemotePreviewFile(address, signal)).rejects.toThrow(
      REMOTE_PREVIEW_UPDATE_REQUIRED_MESSAGE
    )
  })

  it('reports a re-paired environment as a dead pairing, not a transient failure', async () => {
    callRuntimeEnvironment.mockResolvedValue(fail('runtime_environment_changed', 'changed'))
    await expect(readRemotePreviewChunk(address, 0, 1, signal)).rejects.toBeInstanceOf(
      RemotePreviewPairingChangedError
    )
  })
})
