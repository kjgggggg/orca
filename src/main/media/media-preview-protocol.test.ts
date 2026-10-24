import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import type { RemoteMediaAddress } from '../../shared/media-file-extensions'

const { authorize } = vi.hoisted(() => ({
  authorize: vi.fn(async (filePath: string) => filePath)
}))
vi.mock('electron', () => ({
  protocol: { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() }
}))
vi.mock('../ipc/local-file-access-resolution', () => ({
  resolveLocalFileRequestPath: authorize
}))

vi.mock('./media-preview-remote-reader', () => ({
  statRemoteMedia: vi.fn(),
  readRemoteMediaChunk: vi.fn()
}))

import { handleMediaPreviewRequest, readMediaPreview } from './media-preview-protocol'
import { readRemoteMediaChunk, statRemoteMedia } from './media-preview-remote-reader'

describe('media preview protocol', () => {
  let directory: string
  const emitter = new EventEmitter()
  const event = {
    sender: {
      id: 24859,
      on: vi.fn().mockImplementation((name, callback) => emitter.on(name, callback)),
      removeListener: vi
        .fn()
        .mockImplementation((name, callback) => emitter.removeListener(name, callback))
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mocked authorization resolver never reads Store members.
  const store = {} as Store

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'orca-video-protocol-'))
    authorize.mockReset().mockImplementation(async (path) => path)
  })
  afterEach(async () => {
    emitter.emit('destroyed')
    await rm(directory, { recursive: true, force: true })
  })

  it.each(['mp4', 'MOV', 'm4v', 'webm', 'MP3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'flac', 'opus'])(
    'streams %s without returning bytes through IPC',
    async (extension) => {
      const filePath = join(directory, `clip.${extension}`)
      await writeFile(filePath, Uint8Array.from([0, 1, 2, 3, 4, 5]))
      const target = { filePath, access: { kind: 'user-file' } as const }
      const result = readMediaPreview(event, target, store)
      expect(result).toMatchObject({ content: '', isBinary: true })
      expect(result?.mediaUrl).not.toContain(filePath)
      if (!result) {
        throw new Error('Missing preview')
      }
      const response = await handleMediaPreviewRequest(
        new Request(result.mediaUrl, { headers: { range: 'bytes=2-4' } })
      )
      expect(response.status).toBe(206)
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4])
      expect(authorize).toHaveBeenCalledWith(filePath, target.access, store)
    }
  )

  it('rechecks authorization for every seek and revokes URLs with the renderer', async () => {
    const filePath = join(directory, 'clip.mp4')
    await writeFile(filePath, 'video')
    const result = readMediaPreview(event, { filePath }, store)
    if (!result) {
      throw new Error('Missing preview')
    }
    authorize.mockRejectedValueOnce(new Error('Access denied'))
    expect((await handleMediaPreviewRequest(new Request(result.mediaUrl))).status).toBe(404)
    emitter.emit('destroyed')
    expect((await handleMediaPreviewRequest(new Request(result.mediaUrl))).status).toBe(404)
    expect(authorize).toHaveBeenCalledTimes(1)
  })

  it('rejects directories, forged URLs and non-media paths', async () => {
    const result = readMediaPreview(event, { filePath: join(directory, 'folder.mp4') }, store)
    if (!result) {
      throw new Error('Missing preview')
    }
    authorize.mockResolvedValueOnce(directory)
    expect((await handleMediaPreviewRequest(new Request(result.mediaUrl))).status).toBe(404)
    expect((await handleMediaPreviewRequest(new Request('orca-media://file/unknown'))).status).toBe(
      404
    )
    expect(readMediaPreview(event, { filePath: join(directory, 'secret.txt') }, store)).toBeNull()
  })

  it('does not try a local read for an SSH host', async () => {
    const result = readMediaPreview(
      event,
      { filePath: '/remote/clip.mp4', connectionId: 'ssh-owner' },
      store
    )
    if (!result) {
      throw new Error('Missing preview')
    }
    expect((await handleMediaPreviewRequest(new Request(result.mediaUrl))).status).toBe(404)
    expect(authorize).not.toHaveBeenCalled()
  })

  describe('remote targets', () => {
    const addr = (relativePath: string): RemoteMediaAddress => ({
      environmentId: 'env-1',
      worktree: 'id:wt-1',
      relativePath,
      expectedEnvironmentPairingRevision: 3
    })
    const mint = (relativePath = 'out/clip.webm'): string => {
      const result = readMediaPreview(event, { remote: addr(relativePath) }, store)
      if (!result) {
        throw new Error('Missing preview')
      }
      return result.mediaUrl
    }
    beforeEach(() => {
      vi.mocked(statRemoteMedia).mockReset().mockResolvedValue({ size: 6 })
      vi.mocked(readRemoteMediaChunk)
        .mockReset()
        .mockResolvedValue(Uint8Array.from([2, 3, 4]))
    })

    it('mints a remote grant for a media path', () => {
      const result = readMediaPreview(event, { remote: addr('out/clip.webm') }, store)
      expect(result).toMatchObject({ isBinary: true, mimeType: 'video/webm', content: '' })
      expect(result?.mediaUrl).toMatch(/^orca-media:\/\/file\/[^/?]+\?revision=/)
    })

    it('refuses a non-media remote path', () => {
      expect(readMediaPreview(event, { remote: addr('notes.txt') }, store)).toBeNull()
    })

    it('streams a remote range', async () => {
      const request = new Request(mint(), { headers: { range: 'bytes=2-4' } })
      const response = await handleMediaPreviewRequest(request)
      expect(response.status).toBe(206)
      expect(response.headers.get('Content-Range')).toBe('bytes 2-4/6')
      expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4])
      expect(readRemoteMediaChunk).toHaveBeenCalledWith(
        addr('out/clip.webm'),
        2,
        3,
        expect.any(AbortSignal)
      )
    })

    it('cancelling the response body aborts the in-flight remote chunk', async () => {
      let chunkSignal: AbortSignal | undefined
      vi.mocked(readRemoteMediaChunk).mockImplementation((_address, _offset, _length, signal) => {
        chunkSignal = signal
        return new Promise(() => {})
      })
      const response = await handleMediaPreviewRequest(
        new Request(mint(), { headers: { range: 'bytes=2-4' } })
      )
      if (!response.body) {
        throw new Error('Missing body')
      }
      const reader = response.body.getReader()
      void reader.read()
      await vi.waitFor(() => expect(chunkSignal).toBeDefined())
      expect(chunkSignal?.aborted).toBe(false)
      await reader.cancel()
      expect(chunkSignal?.aborted).toBe(true)
    })

    it('forwards request abort to the remote calls', async () => {
      const controller = new AbortController()
      let statSignal: AbortSignal | undefined
      vi.mocked(statRemoteMedia).mockImplementation(async (_address, signal) => {
        statSignal = signal
        return { size: 6 }
      })
      await handleMediaPreviewRequest(new Request(mint(), { signal: controller.signal }))
      controller.abort()
      expect(statSignal?.aborted).toBe(true)
    })

    it('HEAD returns the remote size without reading', async () => {
      const response = await handleMediaPreviewRequest(new Request(mint(), { method: 'HEAD' }))
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Length')).toBe('6')
      expect(readRemoteMediaChunk).not.toHaveBeenCalled()
    })

    it('re-stats on every request so a growing file reports its new size', async () => {
      vi.mocked(statRemoteMedia)
        .mockResolvedValueOnce({ size: 6 })
        .mockResolvedValueOnce({ size: 10 })
      const url = mint()
      const headers = { range: 'bytes=2-4' }
      const first = await handleMediaPreviewRequest(new Request(url, { headers }))
      await first.arrayBuffer()
      const second = await handleMediaPreviewRequest(new Request(url, { headers }))
      await second.arrayBuffer()
      expect(first.headers.get('Content-Range')).toBe('bytes 2-4/6')
      expect(second.headers.get('Content-Range')).toBe('bytes 2-4/10')
    })

    it('serves a zero-byte remote file as an empty body', async () => {
      vi.mocked(statRemoteMedia).mockResolvedValue({ size: 0 })
      const response = await handleMediaPreviewRequest(new Request(mint()))
      expect(response.status).toBe(200)
      expect((await response.arrayBuffer()).byteLength).toBe(0)
      expect(readRemoteMediaChunk).not.toHaveBeenCalled()
    })

    it('a failed chunk errors that stream and the grant still serves the next request', async () => {
      vi.mocked(readRemoteMediaChunk).mockRejectedValueOnce(new Error('boom'))
      const url = mint()
      const headers = { range: 'bytes=2-4' }
      const failed = await handleMediaPreviewRequest(new Request(url, { headers }))
      await expect(failed.arrayBuffer()).rejects.toThrow()
      const next = await handleMediaPreviewRequest(new Request(url, { headers }))
      expect(next.status).toBe(206)
      expect([...new Uint8Array(await next.arrayBuffer())]).toEqual([2, 3, 4])
    })

    it('errors the stream when the server returns more bytes than requested', async () => {
      vi.mocked(readRemoteMediaChunk).mockResolvedValue(Uint8Array.from([2, 3, 4, 5, 6]))
      const response = await handleMediaPreviewRequest(
        new Request(mint(), { headers: { range: 'bytes=2-4' } })
      )
      await expect(response.arrayBuffer()).rejects.toThrow()
    })

    it('returns 502 when the remote stat fails', async () => {
      vi.mocked(statRemoteMedia).mockRejectedValue(new Error('offline'))
      expect((await handleMediaPreviewRequest(new Request(mint()))).status).toBe(502)
    })

    it('drops remote grants when the renderer is destroyed', async () => {
      const url = mint()
      emitter.emit('destroyed')
      expect((await handleMediaPreviewRequest(new Request(url))).status).toBe(404)
    })
  })
})
