import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callRuntimeEnvironment } = vi.hoisted(() => ({ callRuntimeEnvironment: vi.fn() }))
vi.mock('../ipc/runtime-environments/runtime-environment-transport-routing', () => ({
  callRuntimeEnvironment
}))
vi.mock('../persistence', () => ({ getCanonicalUserDataPath: () => '/user-data' }))

import { readRemoteMediaChunk, statRemoteMedia } from './media-preview-remote-reader'

const address = {
  environmentId: 'env-1',
  worktree: 'id:wt-1',
  relativePath: 'out/clip.mp4',
  expectedEnvironmentPairingRevision: 7
}
const ok = (result: unknown) => ({ ok: true, result })
const fail = (code: string, message: string) => ({ ok: false, error: { code, message } })

describe('remote media reader', () => {
  const signal = new AbortController().signal
  beforeEach(() => callRuntimeEnvironment.mockReset())

  it('stat passes worktree, path, 15s timeout, pairing revision and signal', async () => {
    callRuntimeEnvironment.mockResolvedValue(ok({ size: 6, isDirectory: false, mtime: 1 }))
    await expect(statRemoteMedia(address, signal)).resolves.toEqual({ size: 6 })
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

  it('stat rejects a directory', async () => {
    callRuntimeEnvironment.mockResolvedValue(ok({ size: 0, isDirectory: true, mtime: 1 }))
    await expect(statRemoteMedia(address, signal)).rejects.toThrow()
  })

  it('stat rejects a malformed result', async () => {
    callRuntimeEnvironment.mockResolvedValue(ok({ nope: true }))
    await expect(statRemoteMedia(address, signal)).rejects.toThrow()
  })

  it('readChunk decodes base64', async () => {
    callRuntimeEnvironment.mockResolvedValue(
      ok({ contentBase64: 'AAECAw==', bytesRead: 4, eof: false })
    )
    await expect(readRemoteMediaChunk(address, 10, 4, signal)).resolves.toEqual(
      new Uint8Array([0, 1, 2, 3])
    )
    expect(callRuntimeEnvironment).toHaveBeenCalledWith(
      '/user-data',
      'env-1',
      'files.readChunk',
      { worktree: 'id:wt-1', relativePath: 'out/clip.mp4', offset: 10, length: 4 },
      60_000,
      7,
      undefined,
      { signal }
    )
  })

  it('readChunk rejects when bytesRead disagrees with the decoded length', async () => {
    callRuntimeEnvironment.mockResolvedValue(
      ok({ contentBase64: 'AAE=', bytesRead: 4, eof: false })
    )
    await expect(readRemoteMediaChunk(address, 0, 4, signal)).rejects.toThrow()
  })

  it('maps method_not_found to the update-required message', async () => {
    callRuntimeEnvironment.mockResolvedValue(fail('method_not_found', 'x'))
    await expect(statRemoteMedia(address, signal)).rejects.toThrow(
      'Playing remote media requires a newer Orca on the paired machine. Update it and try again.'
    )
  })

  it('passes other server errors through', async () => {
    callRuntimeEnvironment.mockResolvedValue(fail('remote_runtime_unavailable', 'gone'))
    await expect(readRemoteMediaChunk(address, 0, 1, signal)).rejects.toThrow('gone')
  })
})
